#!/usr/bin/env python3
"""Services factices pour les tests d'intégration.

  --source-port P : serveur JSON ; sert le contenu du fichier <dir>/source.json
  --sink-port   Q : faux callback Jeedom ; ajoute chaque corps POST (une ligne JSON) à <dir>/sink.jsonl
"""
import argparse
import http.server
import os
import threading


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--source-port", type=int, required=True)
    ap.add_argument("--sink-port", type=int, required=True)
    a = ap.parse_args()
    lock = threading.Lock()

    class Source(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            try:
                with open(os.path.join(a.dir, "source.json"), "rb") as f:
                    body = f.read()
            except OSError:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    class Sink(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            with lock, open(os.path.join(a.dir, "sink.jsonl"), "ab") as f:
                f.write(body.replace(b"\n", b" ") + b"\n")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

    for port, handler in ((a.source_port, Source), (a.sink_port, Sink)):
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Event().wait()


if __name__ == "__main__":
    main()
