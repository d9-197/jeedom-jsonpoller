#!/usr/bin/env bash
# Lance toute la suite de tests en local (les mêmes vérifications que la CI).
#   tests/run_all.sh          tout (≈ 40 s)
#   tests/run_all.sh quick    sans le test d'intégration PHP (≈ 10 s)
set -u
cd "$(dirname "$0")/.."
fail=0
step() { printf '\n==> %s\n' "$1"; shift; "$@" || { echo "ÉCHEC : $*"; fail=1; }; }

step "Validité de plugin_info/info.json" python3 - <<'PY'
import json, os, sys
info = json.load(open("plugin_info/info.json", encoding="utf-8"))
assert info["id"] == "jsonpoller", "id inattendu"
assert os.path.exists("plugin_info/%s_icon.png" % info["id"]), "icône manquante"
assert os.path.exists("core/class/%s.class.php" % info["id"]), "classe principale manquante"
print("ok :", info["id"], "- Jeedom >=", info["require"])
PY
step "Syntaxe PHP" bash -c "find . -name '*.php' -not -path './.git/*' -print0 | xargs -0 -n1 php -l >/dev/null"
step "Syntaxe JS"  node --check desktop/js/jsonpoller.js
step "Tests JS (interface)" node --test tests/js/*.test.js
step "Compilation Python" python3 -m py_compile resources/jsonpollerd/jsonpollerd.py tests/support/fake_services.py
step "Tests Python (daemon)" python3 -I -m unittest discover -s tests/python
step "Tests PHP (unitaires)" php tests/php/unit.php
if [ "${1:-}" != "quick" ]; then
  step "Tests PHP (intégration avec le vrai daemon)" php tests/php/integration.php
fi
find . -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null
[ $fail -eq 0 ] && echo -e "\nTOUT EST OK" || echo -e "\nDES TESTS ONT ÉCHOUÉ"
exit $fail
