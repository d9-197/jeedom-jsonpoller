#!/usr/bin/env python3
"""jsonpollerd : daemon de scrutation d'URLs JSON pour Jeedom.

Dépendances : bibliothèque standard Python 3 uniquement.

Protocole avec Jeedom :
  - Jeedom -> daemon : socket TCP 127.0.0.1:<socketport>, un message JSON par
    connexion, terminé par un saut de ligne. Champs : apikey, cmd
    ("config" | "refresh" | "ping").
  - daemon -> Jeedom : POST JSON sur l'URL --callback (?apikey=...).
"""
import argparse
import json
import logging
import os
import re
import signal
import socketserver
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

LOG = logging.getLogger("jsonpollerd")
MIN_INTERVAL = 10
MAX_BODY = 5 * 1024 * 1024
MAX_BACKOFF = 300  # délai maximal (s) entre deux essais après des échecs consécutifs
WORKERS = 8


# --------------------------------------------------------------------------
# Extraction d'une valeur dans le JSON : a.b[0].c  /  $.a["x.y"]  /  [-1]
# --------------------------------------------------------------------------
class PathError(Exception):
    pass


_TOKEN = re.compile(
    r"""\.?\[(-?\d+)\]"""              # [0] / [-1]
    r"""|\.?\["([^"]*)"\]"""           # ["clé"]
    r"""|\.?\['([^']*)'\]"""           # ['clé']
    r"""|\.?([^.\[\]]+)"""             # clé simple
)


def extract(data, path):
    path = (path or "").strip()
    if path.startswith("$"):
        path = path[1:]
    cur = data
    pos = 0
    while pos < len(path):
        m = _TOKEN.match(path, pos)
        if not m:
            raise PathError("chemin invalide près de '%s'" % path[pos:])
        pos = m.end()
        idx, dq, sq, key = m.groups()
        try:
            if idx is not None:
                cur = cur[int(idx)]
            else:
                k = dq if dq is not None else sq if sq is not None else key
                if isinstance(cur, list) and dq is None and sq is None and re.fullmatch(r"-?\d+", k):
                    cur = cur[int(k)]
                else:
                    cur = cur[k]
        except (KeyError, IndexError):
            raise PathError("introuvable : '%s'" % m.group(0).lstrip("."))
        except TypeError:
            raise PathError("'%s' impossible sur une valeur de type %s" % (m.group(0).lstrip("."), type(cur).__name__))
    return cur


# --------------------------------------------------------------------------
# Requête HTTP
# --------------------------------------------------------------------------
def fetch(eq):
    """Retourne (http_code, json_décodé). Lève RuntimeError avec le code dans .code."""
    headers = {"Accept": "application/json", "User-Agent": "Jeedom-jsonpoller"}
    headers.update(eq.get("headers") or {})
    method = (eq.get("method") or "GET").upper()
    body = None
    if method == "POST":
        body = (eq.get("body") or "").encode("utf-8")
    req = urllib.request.Request(eq["url"], data=body, method=method, headers=headers)
    ctx = None
    if eq["url"].lower().startswith("https") and not eq.get("verify_ssl", True):
        ctx = ssl._create_unverified_context()
    code = 0
    try:
        with urllib.request.urlopen(req, timeout=eq.get("timeout", 10), context=ctx) as r:
            code = r.status
            raw = r.read(MAX_BODY + 1)
    except urllib.error.HTTPError as e:
        err = RuntimeError("HTTP %d" % e.code)
        err.code = e.code
        raise err
    except Exception as e:
        err = RuntimeError(str(getattr(e, "reason", e)) or e.__class__.__name__)
        err.code = 0
        raise err
    if len(raw) > MAX_BODY:
        err = RuntimeError("réponse trop volumineuse (> 5 Mo)")
        err.code = code
        raise err
    try:
        return code, json.loads(raw.decode("utf-8-sig"))
    except ValueError as e:
        err = RuntimeError("réponse non JSON : %s" % e)
        err.code = code
        raise err


# --------------------------------------------------------------------------
# Planificateur
# --------------------------------------------------------------------------
def next_delay(interval, fails):
    """Délai avant le prochain essai : la période normale tant que tout va bien,
    puis doublement à chaque échec consécutif, plafonné à MAX_BACKOFF
    (jamais en dessous de la période configurée)."""
    if fails <= 0:
        return interval
    return max(interval, min(interval * (2 ** min(fails, 30)), MAX_BACKOFF))


class Scheduler:
    def __init__(self, callback, apikey):
        self.callback = callback
        self.apikey = apikey
        self.lock = threading.Lock()
        self.state = {}  # id -> {cfg, next, running}
        self.pool = ThreadPoolExecutor(max_workers=WORKERS)
        self.stop_evt = threading.Event()
        self.wake = threading.Event()

    def set_config(self, equipments):
        with self.lock:
            new = {}
            for cfg in equipments:
                eid = str(cfg["id"])
                old = self.state.get(eid)
                st = old if old else {"next": 0.0, "running": False, "fails": 0}
                if old and (old["cfg"].get("url"), old["cfg"].get("method")) != (cfg.get("url"), cfg.get("method")):
                    st["fails"] = 0
                    st["next"] = 0.0
                st["cfg"] = cfg
                new[eid] = st
            self.state = new
        LOG.info("Configuration reçue : %d équipement(s)", len(equipments))
        self.wake.set()

    def refresh(self, eid):
        with self.lock:
            st = self.state.get(str(eid))
            if st:
                st["next"] = 0.0
        self.wake.set()

    def run(self):
        while not self.stop_evt.is_set():
            now = time.monotonic()
            due, wait = [], 1.0
            with self.lock:
                for st in self.state.values():
                    if st["running"]:
                        continue
                    if st["next"] <= now:
                        st["running"] = True
                        due.append(st)
                    else:
                        wait = min(wait, st["next"] - now)
            for st in due:
                self.pool.submit(self._poll, st)
            self.wake.wait(max(0.05, wait))
            self.wake.clear()

    def _poll(self, st):
        cfg = st["cfg"]
        started = time.monotonic()
        interval = max(MIN_INTERVAL, int(cfg.get("interval", 30)))
        payload = {"eqId": cfg["id"], "http": 0, "error": "", "values": {}, "errors": {}, "retry_in": 0}
        ok = True
        try:
            code, data = fetch(cfg)
            payload["http"] = code
            for c in cfg.get("commands", []):
                try:
                    payload["values"][str(c["id"])] = extract(data, c["path"])
                except PathError as e:
                    payload["errors"][str(c["id"])] = "%s (chemin '%s')" % (e, c["path"])
        except Exception as e:
            ok = False
            payload["http"] = getattr(e, "code", 0)
            payload["error"] = str(e)

        # Backoff : calculé avant l'envoi pour pouvoir informer Jeedom
        with self.lock:
            previous = st.get("fails", 0)
            st["fails"] = 0 if ok else previous + 1
            delay = next_delay(interval, st["fails"])
        payload["retry_in"] = delay if not ok else 0

        name = cfg.get("name")
        if ok:
            if previous:
                LOG.info("%s : source de nouveau disponible après %d échec(s)", name, previous)
            LOG.debug("%s : %d valeur(s) lue(s)", name, len(payload["values"]))
        elif previous == 0:
            LOG.warning("%s (%s) : %s - nouvel essai dans %ds", name, cfg.get("url"), payload["error"], delay)
        else:
            LOG.debug("%s : échec n°%d (%s) - nouvel essai dans %ds", name, st["fails"], payload["error"], delay)

        try:
            self._send(payload)
        except Exception as e:
            LOG.warning("Callback Jeedom en échec : %s", e)
        finally:
            with self.lock:
                st["running"] = False
                st["next"] = max(time.monotonic(), started + delay)
            self.wake.set()

    def _send(self, payload):
        url = self.callback + ("&" if "?" in self.callback else "?") + urllib.parse.urlencode({"apikey": self.apikey})
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()


# --------------------------------------------------------------------------
# Serveur de commandes (Jeedom -> daemon)
# --------------------------------------------------------------------------
class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        def reply(obj):
            self.wfile.write((json.dumps(obj) + "\n").encode("utf-8"))

        try:
            msg = json.loads(self.rfile.readline(20 * 1024 * 1024).decode("utf-8"))
        except Exception as e:
            return reply({"ok": False, "error": "message invalide: %s" % e})
        if msg.get("apikey") != self.server.apikey:
            LOG.warning("Message refusé : clé API invalide")
            return reply({"ok": False, "error": "apikey"})
        cmd = msg.get("cmd")
        if cmd == "config":
            self.server.scheduler.set_config(msg.get("equipments", []))
        elif cmd == "refresh":
            self.server.scheduler.refresh(msg.get("id"))
        elif cmd != "ping":
            return reply({"ok": False, "error": "commande inconnue"})
        reply({"ok": True})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loglevel", default="info")
    ap.add_argument("--socketport", type=int, default=55081)
    ap.add_argument("--callback", required=True)
    ap.add_argument("--apikey", required=True)
    ap.add_argument("--pid", default="")
    args = ap.parse_args()

    levels = {"debug": logging.DEBUG, "info": logging.INFO, "notice": logging.INFO,
              "warning": logging.WARNING, "error": logging.ERROR,
              "critical": logging.CRITICAL, "none": logging.CRITICAL + 10}
    logging.basicConfig(
        level=levels.get(args.loglevel.lower(), logging.INFO),
        format="[%(asctime)s][%(levelname)s] : %(message)s", stream=sys.stdout)

    if args.pid:
        with open(args.pid, "w") as f:
            f.write(str(os.getpid()))

    sched = Scheduler(args.callback, args.apikey)
    server = Server(("127.0.0.1", args.socketport), Handler)
    server.apikey = args.apikey
    server.scheduler = sched

    def shutdown(*_):
        LOG.info("Arrêt du daemon")
        sched.stop_evt.set()
        sched.wake.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    threading.Thread(target=sched.run, daemon=True).start()
    LOG.info("Daemon démarré (port %d)", args.socketport)
    try:
        server.serve_forever()
    finally:
        sched.pool.shutdown(wait=False, cancel_futures=True)
        if args.pid and os.path.exists(args.pid):
            os.remove(args.pid)


if __name__ == "__main__":
    main()
