"""Tests du daemon jsonpollerd (bibliothèque standard uniquement)."""
import http.server
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DAEMON_DIR = os.path.join(ROOT, "resources", "jsonpollerd")
sys.path.insert(0, DAEMON_DIR)
import jsonpollerd as d  # noqa: E402


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(handler):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/" % srv.server_address[1]


class Base(unittest.TestCase):
    def serve(self, handler):
        srv, url = serve(handler)
        self.addCleanup(srv.server_close)   # exécutés dans l'ordre inverse : shutdown puis server_close
        self.addCleanup(srv.shutdown)
        return srv, url


def quiet(base):
    class H(base):
        def log_message(self, *args):
            pass
    return H


# ---------------------------------------------------------------- extract
class ExtractTests(Base):
    DATA = {
        "Irms": "0.00",
        "data": {"temp": 21.5, "on": True, "list": [{"v": 1}, {"v": 2}], "a.b": "x", "n": None},
        "matrix": [[1, 2], [3, 4]],
    }

    def test_valid_paths(self):
        cases = [
            ("Irms", "0.00"),
            ("data.temp", 21.5),
            ("$.data.on", True),
            ("$data.temp", 21.5),
            ("data.list[0].v", 1),
            ("data.list[-1].v", 2),
            ("data.list.1.v", 2),            # index écrit comme une clé
            ('data["a.b"]', "x"),
            ("data['a.b']", "x"),
            ("matrix[1][0]", 3),
            ("data.n", None),
            ("  data.temp  ", 21.5),          # espaces autour
        ]
        for path, expected in cases:
            with self.subTest(path=path):
                self.assertEqual(d.extract(self.DATA, path), expected)

    def test_empty_path_returns_everything(self):
        self.assertIs(d.extract(self.DATA, ""), self.DATA)
        self.assertIs(d.extract(self.DATA, "$"), self.DATA)

    def test_invalid_paths(self):
        for path in ("data.nope", "data.list[9]", "data.temp.x", "Irms[0]", "matrix[0][5]", "data[\"zz\"]"):
            with self.subTest(path=path):
                with self.assertRaises(d.PathError):
                    d.extract(self.DATA, path)

    def test_root_list(self):
        self.assertEqual(d.extract([{"a": 1}, {"a": 2}], "[1].a"), 2)


# ---------------------------------------------------------------- backoff
class NextDelayTests(Base):
    def test_sequence(self):
        self.assertEqual([d.next_delay(10, f) for f in range(8)], [10, 20, 40, 80, 160, 300, 300, 300])

    def test_never_below_interval(self):
        self.assertEqual(d.next_delay(600, 0), 600)
        self.assertEqual(d.next_delay(600, 5), 600)

    def test_huge_fail_count(self):
        self.assertEqual(d.next_delay(10, 10 ** 6), d.MAX_BACKOFF)


# ---------------------------------------------------------------- fetch
class FetchTests(Base):
    def test_ok_with_bom_and_quoted_numbers(self):
        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'\xef\xbb\xbf{"Irms":"0.00","power":"0.00"}')
        srv, url = self.serve(H)
        code, data = d.fetch({"url": url, "timeout": 5})
        self.assertEqual((code, data), (200, {"Irms": "0.00", "power": "0.00"}))

    def test_http_error_carries_code(self):
        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(503)
                self.end_headers()
        srv, url = self.serve(H)
        with self.assertRaises(RuntimeError) as cm:
            d.fetch({"url": url, "timeout": 5})
        self.assertEqual(cm.exception.code, 503)

    def test_not_json(self):
        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"<html>nope</html>")
        srv, url = self.serve(H)
        with self.assertRaises(RuntimeError) as cm:
            d.fetch({"url": url, "timeout": 5})
        self.assertIn("non JSON", str(cm.exception))
        self.assertEqual(cm.exception.code, 200)

    def test_connection_refused(self):
        with self.assertRaises(RuntimeError) as cm:
            d.fetch({"url": "http://127.0.0.1:%d/" % free_port(), "timeout": 2})
        self.assertEqual(cm.exception.code, 0)

    def test_post_sends_body_and_headers(self):
        seen = {}

        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_POST(self):
                seen["body"] = self.rfile.read(int(self.headers["Content-Length"]))
                seen["auth"] = self.headers.get("Authorization")
                seen["accept"] = self.headers.get("Accept")
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")
        srv, url = self.serve(H)
        d.fetch({"url": url, "method": "POST", "body": '{"q":1}', "headers": {"Authorization": "Bearer t"}, "timeout": 5})
        self.assertEqual(seen, {"body": b'{"q":1}', "auth": "Bearer t", "accept": "application/json"})

    def test_total_deadline_on_slow_drip(self):
        """Un serveur qui répond au compte-gouttes ne doit pas contourner le timeout."""
        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                try:
                    self.wfile.write(b'{"a":"')
                    self.wfile.flush()
                    for _ in range(30):
                        time.sleep(0.5)
                        self.wfile.write(b"x")
                        self.wfile.flush()
                except OSError:
                    pass
        srv, url = self.serve(H)
        t0 = time.monotonic()
        with self.assertRaises(RuntimeError) as cm:
            d.fetch({"url": url, "timeout": 1})
        self.assertLess(time.monotonic() - t0, 4)
        self.assertIn("délai total", str(cm.exception))

    def test_large_body(self):
        body = json.dumps({"items": [{"i": i, "t": "x" * 20} for i in range(8000)]}).encode()

        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        srv, url = self.serve(H)
        _, data = d.fetch({"url": url, "timeout": 5})
        self.assertEqual(len(data["items"]), 8000)

    def test_body_too_large(self):
        old = d.MAX_BODY
        d.MAX_BODY = 1000
        self.addCleanup(setattr, d, "MAX_BODY", old)

        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'["' + b"x" * 5000 + b'"]')
        srv, url = self.serve(H)
        with self.assertRaises(RuntimeError) as cm:
            d.fetch({"url": url, "timeout": 5})
        self.assertIn("volumineuse", str(cm.exception))


# ---------------------------------------------------------------- planificateur
def make_sched():
    sched = d.Scheduler("http://127.0.0.1:1/cb", "K")
    sent = []
    sched._send = lambda payload: sent.append(json.loads(json.dumps(payload)))  # copie : l'original est muté
    return sched, sent


def new_state(cfg=None):
    return {"cfg": cfg or {"id": 1, "name": "t"}, "next": 0.0, "running": True, "fails": 0,
            "last": {}, "sig": None, "last_sent": None}


def payload(values=None, http_code=200, error="", errors=None):
    return {"eqId": 1, "http": http_code, "error": error, "values": dict(values or {}),
            "errors": dict(errors or {}), "retry_in": 0}


class DifferentialSendTests(Base):
    def setUp(self):
        self.sched, self.sent = make_sched()
        self.st = new_state()

    def report(self, **kw):
        self.sched._report(self.st, payload(**kw))

    def test_first_report_sends_everything(self):
        self.report(values={"1": 20.5, "2": True})
        self.assertEqual(self.sent[0]["values"], {"1": 20.5, "2": True})

    def test_unchanged_sends_nothing(self):
        self.report(values={"1": 20.5})
        self.report(values={"1": 20.5})
        self.report(values={"1": 20.5})
        self.assertEqual(len(self.sent), 1)

    def test_only_changed_values_are_sent(self):
        self.report(values={"1": 20.5, "2": 1})
        self.report(values={"1": 21.0, "2": 1})
        self.assertEqual(self.sent[1]["values"], {"1": 21.0})

    def test_true_and_one_are_different(self):
        self.report(values={"1": True})
        self.report(values={"1": 1})
        self.assertEqual(len(self.sent), 2)

    def test_state_change_is_sent_even_without_values(self):
        self.report(values={"1": 1})
        self.report(values={}, http_code=500, error="HTTP 500")
        self.assertEqual(len(self.sent), 2)
        self.assertEqual(self.sent[1]["error"], "HTTP 500")
        self.report(values={}, http_code=500, error="HTTP 500")   # même état : rien
        self.assertEqual(len(self.sent), 2)

    def test_recovery_resends_values_unchanged_since(self):
        self.report(values={"1": 1})
        self.report(values={}, http_code=0, error="boom")
        self.report(values={"1": 1})                               # source rétablie, même valeur
        self.assertEqual(len(self.sent), 3)                        # l'état repasse en "ok" => envoi

    def test_path_errors_are_part_of_the_state(self):
        self.report(values={}, errors={"9": "introuvable"})
        self.report(values={}, errors={"9": "introuvable"})
        self.assertEqual(len(self.sent), 1)
        self.report(values={}, errors={})
        self.assertEqual(len(self.sent), 2)

    def test_heartbeat_sends_everything(self):
        self.report(values={"1": 1, "2": 2})
        self.st["last_sent"] -= d.HEARTBEAT + 1
        self.report(values={"1": 1, "2": 2})
        self.assertEqual(len(self.sent), 2)
        self.assertEqual(self.sent[1]["values"], {"1": 1, "2": 2})

    def test_failed_callback_means_everything_is_resent(self):
        self.sched._send = lambda p: (_ for _ in ()).throw(OSError("down"))
        self.report(values={"1": 1})
        self.assertEqual(self.sched.cb_fail_streak, 1)
        self.assertEqual(self.st["last"], {})
        self.sched._send = lambda p: self.sent.append(p)
        self.report(values={"1": 1})
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sched.cb_fail_streak, 0)

    def test_refresh_forces_full_send(self):
        self.sched.state = {"1": self.st}
        self.report(values={"1": 1})
        self.sched.refresh(1)
        self.report(values={"1": 1})
        self.assertEqual(len(self.sent), 2)

    def test_set_config_resets_sent_state(self):
        cfg = {"id": 1, "name": "t", "url": "http://x/", "commands": []}
        self.sched.set_config([cfg])
        st = self.sched.state["1"]
        self.sched._report(st, payload(values={"1": 1}))
        self.sched.set_config([cfg])                               # même config : on renvoie quand même tout
        self.sched._report(self.sched.state["1"], payload(values={"1": 1}))
        self.assertEqual(len(self.sent), 2)


class PollTests(Base):
    def setUp(self):
        self._min = d.MIN_INTERVAL
        d.MIN_INTERVAL = 1
        self.addCleanup(setattr, d, "MIN_INTERVAL", self._min)
        self.sched, self.sent = make_sched()

    def poll(self, st):
        st["running"] = True
        self.sched._poll(st)

    def test_values_and_path_errors(self):
        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"Irms":"0.00","a":{"b":[1,2]}}')
        srv, url = self.serve(H)
        st = new_state({"id": 7, "name": "t", "url": url, "interval": 1, "timeout": 5,
                        "commands": [{"id": 1, "path": "Irms"}, {"id": 2, "path": "a.b[1]"}, {"id": 3, "path": "zzz"}]})
        self.poll(st)
        p = self.sent[0]
        self.assertEqual((p["eqId"], p["http"], p["error"]), (7, 200, ""))
        self.assertEqual(p["values"], {"1": "0.00", "2": 2})
        self.assertEqual(list(p["errors"]), ["3"])
        self.assertEqual(st["fails"], 0)              # un chemin invalide n'est pas un échec de la source

    def test_backoff_then_recovery(self):
        up = {"ok": False}

        class H(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200 if up["ok"] else 500)
                self.end_headers()
                self.wfile.write(b'{"v":1}')
        srv, url = self.serve(H)
        st = new_state({"id": 1, "name": "t", "url": url, "interval": 1, "timeout": 5,
                        "commands": [{"id": 1, "path": "v"}]})
        delays = []
        for _ in range(4):
            t0 = time.monotonic()
            self.poll(st)
            delays.append(round(st["next"] - t0))   # délai réellement planifié (l'envoi est différentiel)
        self.assertEqual(delays, [2, 4, 8, 16])
        self.assertEqual(st["fails"], 4)
        up["ok"] = True
        self.poll(st)
        self.assertEqual((st["fails"], self.sent[-1]["retry_in"], self.sent[-1]["values"]), (0, 0, {"1": 1}))


class StatusTests(Base):
    def test_status_and_stuck_detection(self):
        sched, _ = make_sched()
        sched.set_config([{"id": 3, "name": "a", "timeout": 2}, {"id": 1, "name": "b", "timeout": 2}])
        s = sched.status()
        self.assertEqual((s["equipments"], s["running"], s["stuck"], s["cb_fail_streak"]), ([1, 3], 0, [], 0))
        with sched.lock:
            sched.state["3"]["running"] = True
            sched.state["3"]["started"] = time.monotonic() - 100   # > 3 * 2 + 30
        s = sched.status()
        self.assertEqual((s["running"], s["stuck"]), (1, [3]))


# ---------------------------------------------------------------- protocole socket
class SocketProtocolTests(Base):
    def setUp(self):
        self.sched = d.Scheduler("http://127.0.0.1:1/cb", "KEY")
        self.server = d.Server(("127.0.0.1", 0), d.Handler)
        self.server.apikey = "KEY"
        self.server.scheduler = self.sched
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, msg, raw=None):
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as s:
            s.sendall(raw if raw is not None else (json.dumps(msg) + "\n").encode())
            with s.makefile() as f:
                return json.loads(f.readline())

    def test_bad_apikey_is_rejected(self):
        r = self.call({"apikey": "BAD", "cmd": "config", "equipments": [{"id": 1}]})
        self.assertFalse(r["ok"])
        self.assertEqual(self.sched.state, {})

    def test_invalid_message(self):
        self.assertFalse(self.call(None, raw=b"pas du json\n")["ok"])

    def test_unknown_command(self):
        self.assertFalse(self.call({"apikey": "KEY", "cmd": "zzz"})["ok"])

    def test_ping_config_status_refresh(self):
        self.assertTrue(self.call({"apikey": "KEY", "cmd": "ping"})["ok"])
        eqs = [{"id": 2, "name": "b", "url": "http://x/"}, {"id": 1, "name": "a", "url": "http://x/"}]
        self.assertTrue(self.call({"apikey": "KEY", "cmd": "config", "equipments": eqs})["ok"])
        st = self.call({"apikey": "KEY", "cmd": "status"})
        self.assertTrue(st["ok"])
        self.assertEqual(st["equipments"], [1, 2])
        self.assertTrue(self.call({"apikey": "KEY", "cmd": "refresh", "id": 1})["ok"])
        # config réduite : l'équipement retiré disparaît
        self.call({"apikey": "KEY", "cmd": "config", "equipments": eqs[:1]})
        self.assertEqual(self.call({"apikey": "KEY", "cmd": "status"})["equipments"], [2])


# ---------------------------------------------------------------- processus complet
class ProcessTests(Base):
    """Lance le vrai daemon (sous-processus) avec une source et un faux callback Jeedom."""

    def test_end_to_end(self):
        received = []

        class Sink(quiet(http.server.BaseHTTPRequestHandler)):
            def do_POST(self):
                received.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")

        class Src(quiet(http.server.BaseHTTPRequestHandler)):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"Irms":"1.50","power":"0.00"}')
        sink, sink_url = self.serve(Sink)
        src, src_url = self.serve(Src)

        port = free_port()
        pidfile = os.path.join(tempfile.mkdtemp(), "d.pid")
        proc = subprocess.Popen(
            [sys.executable, os.path.join(DAEMON_DIR, "jsonpollerd.py"), "--loglevel", "debug",
             "--socketport", str(port), "--callback", sink_url + "cb.php", "--apikey", "K", "--pid", pidfile],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.addCleanup(proc.stdout.close)
        self.addCleanup(lambda: proc.poll() is None and proc.kill())

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                socket.create_connection(("127.0.0.1", port), timeout=1).close()
                break
            except OSError:
                time.sleep(0.1)
        else:
            self.fail("le daemon n'écoute pas")
        with open(pidfile) as f:
            self.assertEqual(int(f.read()), proc.pid)

        cfg = {"apikey": "K", "cmd": "config", "equipments": [{
            "id": 5, "name": "t", "url": src_url, "interval": 10, "timeout": 5,
            "commands": [{"id": 1, "path": "Irms"}, {"id": 2, "path": "power"}]}]}
        with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
            s.sendall((json.dumps(cfg) + "\n").encode())
            with s.makefile() as f:
                self.assertTrue(json.loads(f.readline())["ok"])

        deadline = time.monotonic() + 10
        while not received and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertTrue(received, "aucun callback reçu")
        path, body = received[0]
        self.assertEqual(path, "/cb.php?apikey=K")
        self.assertEqual((body["eqId"], body["http"], body["error"]), (5, 200, ""))
        self.assertEqual(body["values"], {"1": "1.50", "2": "0.00"})

        proc.send_signal(signal.SIGTERM)
        self.assertEqual(proc.wait(timeout=10), 0)
        self.assertFalse(os.path.exists(pidfile), "le fichier pid doit être supprimé à l'arrêt")


if __name__ == "__main__":
    unittest.main()
