"""Traductions : chaque texte français de l'interface doit avoir une traduction anglaise, et inversement."""
import json
import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEMPLATE_FILES = ["desktop/php/jsonpoller.php", "desktop/js/jsonpoller.js", "plugin_info/configuration.php"]
PHP_FILES = ["core/class/jsonpoller.class.php", "core/ajax/jsonpoller.ajax.php", "plugin_info/install.php"]


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def source_strings():
    found = {}
    for rel in TEMPLATE_FILES:
        found[rel] = set(re.findall(r"\{\{(.+?)\}\}", read(rel), re.S))
    for rel in PHP_FILES:
        found[rel] = {m.replace("\\'", "'") for m in re.findall(r"__\('((?:[^'\\]|\\.)*)',\s*__FILE__\)", read(rel))}
    return {"plugins/jsonpoller/" + k: v for k, v in found.items() if v}


class I18nTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, "core/i18n/en_US.json"), encoding="utf-8") as f:
            cls.en = json.load(f)
        cls.src = source_strings()

    def test_every_string_is_translated(self):
        for path, strings in self.src.items():
            for s in strings:
                with self.subTest(file=path, string=s[:50]):
                    self.assertTrue(self.en.get(path, {}).get(s), "traduction manquante")

    def test_no_stale_translation(self):
        for path, table in self.en.items():
            for s in table:
                with self.subTest(file=path, string=s[:50]):
                    self.assertIn(s, self.src.get(path, set()), "traduction orpheline (texte supprimé du code ?)")

    def test_placeholders_are_preserved(self):
        for path, table in self.en.items():
            for fr, en in table.items():
                with self.subTest(string=fr[:50]):
                    # syntaxe littérale à conserver (les exemples de noms, eux, peuvent être localisés)
                    for token in ("&quot;", "[*]", "[?(...)]", "#variable(", "Authorization: Bearer"):
                        if token in fr:
                            self.assertIn(token, en)


if __name__ == "__main__":
    unittest.main()
