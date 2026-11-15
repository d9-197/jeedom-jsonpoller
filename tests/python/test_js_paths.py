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
    "items": [{"id": 1, "v": "1.5", "on": True}, {"id": 2, "v": "2,5", "on": False}, {"id": 3, "v": 4, "on": True}],
    "sp": [{"id": 1, "a.b": 5, "q\"x": 7}, {"id": 2, "a.b": 6, "q\"x": 8}],
    "named": [{"name": "x y", "t": 1}, {"name": "f(1)", "t": 2}, {"name": "q\"uote", "t": 3}],
    "deep": {"list": [{"id": "a", "n": {"x": 1}}, {"id": "b", "n": {"x": 2}}]},
    "noid": [{"v": 1}, {"v": 2}],
}


@unittest.skipUnless(shutil.which("node"), "node absent")
class JsPathsMatchDaemon(unittest.TestCase):
    def rows(self):
        script = os.path.join(ROOT, "tests", "js", "dump_paths.js")
        out = subprocess.run(["node", script], input=json.dumps(SAMPLE), capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_every_generated_path_resolves_to_its_value(self):
        rows = self.rows()
        self.assertGreaterEqual(len(rows), 40)
        for row in rows:
            with self.subTest(path=row["path"]):
                self.assertEqual(d.extract(SAMPLE, row["path"]), row["value"])

    def test_every_alternative_is_understood_by_the_daemon(self):
        """Filtres par identifiant et jokers proposés dans le menu des tableaux."""
        checked = {"filter": 0, "sum": 0, "list": 0, "first": 0, "count": 0}
        for row in self.rows():
            for alt in row["alts"]:
                with self.subTest(path=alt["path"], agg=alt["agg"]):
                    got = d.extract(SAMPLE, alt["path"], alt["agg"])
                    if alt["id"] == "filter":
                        self.assertEqual(got, row["value"], "le filtre doit désigner la même valeur que l'index")
                    elif alt["id"] == "list":
                        self.assertIn(row["value"], got)
                    elif alt["id"] == "count":
                        self.assertEqual(got, len(d.extract(SAMPLE, alt["path"], "list")))
                    elif alt["id"] in ("sum", "avg", "min", "max"):
                        self.assertIsInstance(got, (int, float))
                    checked[alt["id"]] = checked.get(alt["id"], 0) + 1
        for kind in ("filter", "sum", "list", "first", "count"):
            self.assertGreater(checked[kind], 0, "aucune alternative '%s' générée par l'échantillon" % kind)

    def test_arrays_without_identifier_get_no_filter(self):
        for row in self.rows():
            if row["path"].startswith("noid[") or row["path"].startswith("top["):
                self.assertNotIn("filter", [a["id"] for a in row["alts"]], row["path"])


if __name__ == "__main__":
    unittest.main()
