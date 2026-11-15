"""Cohérence JS <-> Python : tout chemin généré par l'explorateur JavaScript doit être compris par le daemon."""
import json
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "resources", "jsonpollerd"))
import jsonpollerd as d  # noqa: E402

SAMPLE = {
    "Irms": "0.00",
    "data": {"temp": 21.5, "on": True, "nothing": None, "a.b": "x", "with space": 1, "quote\"d": 2, "it's": 3, "1st": 4,
             "list": [{"v": 1}, {"v": 2}], "matrix": [[1, 2], [3, 4]], "dash-key": 5, "ünï": 6,
             "$dollar": 7, "*": 8, " lead": 9, "": 10, "with]br": 11, "both\"and'": 12},
    "top": [10, 20],
}


@unittest.skipUnless(shutil.which("node"), "node absent")
class JsPathsMatchDaemon(unittest.TestCase):
    def test_every_generated_path_resolves_to_its_value(self):
        script = os.path.join(ROOT, "tests", "js", "dump_paths.js")
        out = subprocess.run(["node", script], input=json.dumps(SAMPLE), capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = json.loads(out.stdout)
        self.assertGreaterEqual(len(rows), 15)
        for row in rows:
            with self.subTest(path=row["path"]):
                self.assertEqual(d.extract(SAMPLE, row["path"]), row["value"])


if __name__ == "__main__":
    unittest.main()
