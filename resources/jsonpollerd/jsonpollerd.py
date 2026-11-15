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
HEARTBEAT = 60     # s : envoi complet (état + toutes les valeurs) au moins à cette fréquence
MAX_BACKOFF = 300  # délai maximal (s) entre deux essais après des échecs consécutifs
WORKERS = 8


# --------------------------------------------------------------------------
# Extraction d'une valeur dans le JSON : a.b[0].c  /  $.a["x.y"]  /  [-1]
# --------------------------------------------------------------------------
class PathError(Exception):
    pass


_TOKEN = re.compile(
    r"""\.?\[\?\((.*?)\)\]"""        # 1 : filtre  [?(@.id==3)]
    r"""|\.?\[\*\]|\.\*"""            # joker      [*]  ou  .*
    r"""|\.?\[(-?\d+)\]"""            # 2 : index  [0] / [-1]
    r"""|\.?\["([^"]*)"\]"""          # 3 : clé    ["a.b"]
    r"""|\.?\['([^']*)'\]"""          # 4 : clé    ['a.b']
    r"""|\.?([^.\[\]]+)"""            # 5 : clé simple
)
_FILTER = re.compile(r"^\s*@((?:\.[^\s=!<>]+|\[[^\]]*\])*)\s*(?:(==|!=|<=|>=|<|>)\s*(.+?))?\s*$")
AGGREGATIONS = ("first", "last", "sum", "avg", "min", "max", "count", "list")


def _num(v):
    """Nombre (ou chaîne numérique, virgule acceptée) -> float/int ; sinon None."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v.strip().replace(",", "."))
        except ValueError:
            return None
    return None


def _loose_eq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) != isinstance(b, (int, float)):   # nombre contre texte : "3" == 3
        x, y = _num(a), _num(b)
        return x is not None and y is not None and x == y
    return a == b


def _compare(a, op, b):
    if op == "==":
        return _loose_eq(a, b)
    if op == "!=":
        return not _loose_eq(a, b)
    x, y = _num(a), _num(b)
    if x is None or y is None:
        if isinstance(a, str) and isinstance(b, str):
            x, y = a, b
        else:
            return False
    return {"<": x < y, "<=": x <= y, ">": x > y, ">=": x >= y}[op]


def _has_multi(path):
    """Le chemin contient-il un joker ou un filtre ?"""
    pos = 0
    while pos < len(path):
        m = _TOKEN.match(path, pos)
        if not m:
            return False
        if m.group(1) is not None or all(g is None for g in m.groups()):
            return True
        pos = m.end()
    return False


def _match(item, expr):
    """Prédicat de filtre : @.cle  (existence)  ou  @.cle OP valeur."""
    m = _FILTER.match(expr)
    if not m:
        raise PathError("filtre invalide : '%s'" % expr)
    sub, op, lit = m.groups()
    if _has_multi(sub):                 # erreur de syntaxe : détectée même si aucune clé n'existe
        raise PathError("jokers et filtres interdits dans un filtre : '%s'" % expr)
    try:
        nodes, _ = select(item, sub)
    except PathError:
        return False                    # l'élément n'a pas cette clé : il ne correspond pas
    if not nodes:
        return False
    if op is None:
        return True
    if len(lit) >= 2 and lit[0] == lit[-1] == "'":
        value = lit[1:-1]
    else:
        try:
            value = json.loads(lit)
        except ValueError:
            raise PathError("valeur de filtre invalide : '%s'" % lit)
    return _compare(nodes[0], op, value)


def _child(cur, idx, key, step):
    try:
        if idx is not None:
            if not isinstance(cur, list):   # ne pas indexer une chaîne ("abc"[0] = "a")
                raise TypeError
            return cur[int(idx)]
        if not isinstance(cur, dict):
            raise TypeError
        return cur[key]
    except (KeyError, IndexError):
        raise PathError("introuvable : '%s'" % step)
    except TypeError:
        raise PathError("'%s' impossible sur une valeur de type %s" % (step, type(cur).__name__))


def select(data, path):
    """Retourne (noeuds, multiple). multiple=True si le chemin contient un joker ou un filtre."""
    path = (path or "").strip()
    if path.startswith("$"):
        path = path[1:]
    nodes, multi, pos = [data], False, 0
    while pos < len(path):
        m = _TOKEN.match(path, pos)
        if not m:
            raise PathError("chemin invalide près de '%s'" % path[pos:])
        pos = m.end()
        flt, idx, dq, sq, key = m.groups()
        step = m.group(0).lstrip(".")
        if flt is not None or all(g is None for g in m.groups()):      # filtre ou joker
            multi = True
            nxt = []
            for n in nodes:
                if isinstance(n, list):
                    items = n
                elif isinstance(n, dict) and flt is None:
                    items = list(n.values())
                else:
                    continue
                nxt.extend(items if flt is None else [i for i in items if _match(i, flt)])
            nodes = nxt
            continue
        k = dq if dq is not None else sq if sq is not None else key
        nxt = []
        for n in nodes:
            i = idx
            if i is None and isinstance(n, list) and dq is None and sq is None and re.fullmatch(r"-?\d+", k):
                i = k  # "list.1.v" : index écrit comme une clé
            try:
                nxt.append(_child(n, i, k, step))
            except PathError:
                if not multi:
                    raise
                # sélection multiple : les éléments qui n'ont pas la clé sont simplement ignorés
        nodes = nxt
    return nodes, multi


def aggregate(values, agg):
    if agg == "list":
        return values
    if agg == "count":
        return len(values)
    if agg in ("sum", "avg", "min", "max"):
        nums = [n for n in map(_num, values) if n is not None]
        if not nums:
            raise PathError("aucune valeur numérique à agréger (%s)" % agg)
        r = {"sum": sum, "avg": lambda x: sum(x) / len(x), "min": min, "max": max}[agg](nums)
        return round(r, 10) if isinstance(r, float) else r
    if not values:                       # first / last (et valeur inconnue = first)
        raise PathError("aucune valeur sélectionnée")
    return values[-1] if agg == "last" else values[0]


def extract(data, path, agg="first"):
    """Valeur désignée par le chemin : a.b[0].c  /  $.a["x.y"]  /  items[*].v  /  items[?(@.id==3)].v
    Sans joker ni filtre : la valeur (erreur si introuvable). Avec : agrégation `agg`
    (first, last, sum, avg, min, max, count, list)."""
    nodes, multi = select(data, path)
    return aggregate(nodes, agg or "first") if multi else nodes[0]


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
    deadline = time.monotonic() + eq.get("timeout", 10)  # délai TOTAL (le timeout du socket est par opération)
    try:
        with urllib.request.urlopen(req, timeout=eq.get("timeout", 10), context=ctx) as r:
            code = r.status
            chunks, size = [], 0
            read = getattr(r, "read1", r.read)  # read1 rend la main dès qu'un morceau arrive (read bloque jusqu'à 64 Ko)
            while True:
                chunk = read(65536)
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_BODY:
                    break
                if time.monotonic() > deadline:
                    raise TimeoutError("délai total dépassé")
            raw = b"".join(chunks)
    except urllib.error.HTTPError as e:
        e.close()
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
def _ser(value):
    """Forme comparable d'une valeur (distingue true de 1 et "1" de 1)."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


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
        self.started_at = time.monotonic()
        self.last_tick = time.monotonic()  # battement de cœur de la boucle de planification
        self.cb_fail_streak = 0            # échecs consécutifs d'appel du callback Jeedom

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
                # La conversion (format, facteur...) est faite côté Jeedom : après tout
                # changement de configuration, on renvoie tout au prochain cycle.
                st["last"], st["sig"], st["last_sent"] = {}, None, None
                new[eid] = st
            self.state = new
        LOG.info("Configuration reçue : %d équipement(s)", len(equipments))
        self.wake.set()

    def refresh(self, eid):
        with self.lock:
            st = self.state.get(str(eid))
            if st:
                st["next"] = 0.0
                st["last_sent"] = None  # le bouton Rafraîchir force un envoi complet
        self.wake.set()

    def run(self):
        while not self.stop_evt.is_set():
            now = time.monotonic()
            self.last_tick = now
            due, wait = [], 1.0
            with self.lock:
                for st in self.state.values():
                    if st["running"]:
                        continue
                    if st["next"] <= now:
                        st["running"] = True
                        st["started"] = now
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
                    payload["values"][str(c["id"])] = extract(data, c["path"], c.get("agg", "first"))
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
            self._report(st, payload)
        finally:
            with self.lock:
                st["running"] = False
                st["next"] = max(time.monotonic(), started + delay)
            self.wake.set()

    def _report(self, st, payload):
        """Envoie à Jeedom uniquement ce qui a changé : valeurs modifiées, changement d'état
        (HTTP/erreur), et un envoi complet au moins toutes les HEARTBEAT secondes."""
        now = time.monotonic()
        last = st.setdefault("last", {})
        full = st.get("last_sent") is None or now - st["last_sent"] >= HEARTBEAT
        values = payload["values"]
        to_send = {k: v for k, v in values.items() if full or k not in last or _ser(last[k]) != _ser(v)}
        sig = (payload["http"], payload["error"], _ser(payload["errors"]))
        if not (full or to_send or sig != st.get("sig")):
            LOG.debug("%s : rien de nouveau, pas d'appel à Jeedom", st["cfg"].get("name"))
            return
        payload["values"] = to_send
        try:
            self._send(payload)
        except Exception as e:
            # rien n'est mémorisé : le prochain cycle renverra tout
            self.cb_fail_streak += 1
            LOG.warning("Callback Jeedom en échec (%d de suite) : %s", self.cb_fail_streak, e)
            return
        self.cb_fail_streak = 0
        last.update(to_send)
        st["sig"] = sig
        st["last_sent"] = now

    def status(self):
        now = time.monotonic()
        with self.lock:
            ids = sorted(int(k) for k in self.state.keys())
            running = [st for st in self.state.values() if st["running"]]
            stuck = [int(st["cfg"]["id"]) for st in running
                     if now - st.get("started", now) > 3 * int(st["cfg"].get("timeout", 10)) + 30]
        return {
            "loop_age": round(now - self.last_tick, 1),   # s depuis le dernier tour de la boucle
            "equipments": ids,                            # équipements connus du daemon
            "running": len(running),
            "stuck": stuck,                               # scrutations anormalement longues
            "cb_fail_streak": self.cb_fail_streak,
            "uptime": int(now - self.started_at),
        }

    def _send(self, payload):
        req = urllib.request.Request(
            self.callback, data=json.dumps(payload).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "X-Jeedom-Apikey": self.apikey})
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
        elif cmd == "status":
            return reply(dict(self.server.scheduler.status(), ok=True))
        elif cmd != "ping":
            return reply({"ok": False, "error": "commande inconnue"})
        reply({"ok": True})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser(allow_abbrev=False)  # pas d'abréviation : --apikey ne doit pas devenir --apikey-file
    ap.add_argument("--loglevel", default="info")
    ap.add_argument("--socketport", type=int, default=55081)
    ap.add_argument("--callback", required=True)
    ap.add_argument("--apikey-file", default="",
                    help="fichier (mode 0600) contenant la clé API ; supprimé après lecture. "
                         "À défaut : variable d'environnement JSONPOLLER_APIKEY. Jamais en argument.")
    ap.add_argument("--pid", default="")
    args = ap.parse_args()

    levels = {"debug": logging.DEBUG, "info": logging.INFO, "notice": logging.INFO,
              "warning": logging.WARNING, "error": logging.ERROR,
              "critical": logging.CRITICAL, "none": logging.CRITICAL + 10}
    logging.basicConfig(
        level=levels.get(args.loglevel.lower(), logging.INFO),
        format="[%(asctime)s][%(levelname)s] : %(message)s", stream=sys.stdout)

    apikey = os.environ.get("JSONPOLLER_APIKEY", "")
    if args.apikey_file:
        try:
            with open(args.apikey_file, encoding="utf-8") as f:
                apikey = f.read().strip()
            os.remove(args.apikey_file)  # la clé ne reste pas sur le disque
        except OSError as e:
            ap.error("lecture de la clé API impossible : %s" % e)
    if not apikey:
        ap.error("clé API absente (--apikey-file ou JSONPOLLER_APIKEY)")

    if args.pid:
        with open(args.pid, "w") as f:
            f.write(str(os.getpid()))

    sched = Scheduler(args.callback, apikey)
    server = Server(("127.0.0.1", args.socketport), Handler)
    server.apikey = apikey
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
        try:
            sched.pool.shutdown(wait=False, cancel_futures=True)
        except TypeError:  # Python < 3.9
            sched.pool.shutdown(wait=False)
        if args.pid and os.path.exists(args.pid):
            os.remove(args.pid)


if __name__ == "__main__":
    main()
