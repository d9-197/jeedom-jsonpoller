# JSON Poller — plugin Jeedom

Scrute des URLs retournant du JSON (période minimale **10 s**) et alimente des commandes
*info* à partir de valeurs choisies dans le JSON. Daemon Python 3, **aucune dépendance**
à installer.

## Installation (sans le Market)

Le dossier du plugin doit s'appeler `jsonpoller` (= id dans `plugin_info/info.json`).

**Option A – Fichier ZIP** : Jeedom → *Plugins → Gestion des plugins → + (Ajouter) → Source « Fichier »*,
puis envoyer `jsonpoller.zip` (contenu = racine du plugin, sans dossier parent).

**Option B – GitHub** : pousser ce dépôt sur GitHub, puis activer
*Réglages → Système → Configuration → Mises à jour/Market → Github* (jeton si dépôt privé),
et *Plugins → Gestion des plugins → + → Source « Github »* (utilisateur / dépôt / branche).
Les mises à jour se font ensuite depuis le Centre de mise à jour.

Ensuite : activer le plugin, **démarrer le daemon** (page de configuration du plugin).
Jeedom le relance automatiquement s'il tombe (gestion automatique activée par défaut).

## Utilisation

1. *Plugins → Programmation → JSON Poller → Ajouter*.
2. Renseigner l'URL, la période (≥ 10 s), éventuellement en-têtes / méthode POST / corps.
3. Bouton **« Tester l'URL et choisir des valeurs »** : affiche toutes les valeurs du JSON ;
   un clic sur une ligne crée la commande info (chemin et sous-type pré-remplis).
4. Sauvegarder. Le daemon reçoit la configuration immédiatement.

### Syntaxe des chemins

| Chemin | Signification |
|---|---|
| `data.temperature` | clé imbriquée |
| `items[0].value` | élément de tableau (`[-1]` = dernier) |
| `$.a["clé.avec.point"]` | clé contenant des caractères spéciaux (`$` initial optionnel) |
| *(vide)* | JSON entier |

Objets/tableaux sélectionnés : remontés en texte JSON. Les booléens sont convertis en 0/1
pour une commande binaire ou numérique.

### Format de la valeur

Chaque commande a une option *Format* : **automatique** (selon le sous-type), **nombre** (`"0.00"`, `"1,5"` ou `"21.5 °C"` deviennent des nombres), **booléen** (`true`/`on`/`yes`/`1` → 1) ou **texte**. L'explorateur de JSON détecte les nombres écrits entre guillemets et préconfigure le format *nombre*.

Commandes créées automatiquement : *Code HTTP*, *Erreur*, *Dernière réponse OK* (infos), *Rafraîchir* (action).

*Dernière réponse OK* contient la date/heure (`AAAA-MM-JJ hh:mm:ss`, heure du serveur) de la dernière scrutation réussie ;
elle n'est pas mise à jour en cas d'erreur, ce qui permet de détecter une source muette
(ex. dans un scénario : `time() - strtotime(#[Objet][Équipement][Dernière réponse OK]#) > 300`).
Sur un équipement existant, la commande apparaît à la première réponse du daemon après la mise à jour.

### Échecs et espacement des essais

Si une source ne répond pas (réseau, timeout, HTTP ≥ 400, réponse non JSON), le daemon double le délai à chaque
échec consécutif : période, 2×, 4×, 8×… plafonné à **5 minutes** (jamais en dessous de la période configurée).
Dès qu'une réponse valide arrive, la période normale reprend. Le bouton *Rafraîchir* force un essai immédiat.
Seul le premier échec est journalisé en `warning` (les suivants en `debug`) ; le retour à la normale est journalisé en `info`.
Un chemin JSON introuvable n'est pas un échec de la source : la période n'est pas modifiée.

## Architecture

```
Jeedom (PHP) ──socket TCP 127.0.0.1:55081 (config, refresh)──▶ jsonpollerd.py
Jeedom (PHP) ◀──POST core/php/jeeJsonpoller.php?apikey=…──────  (valeurs lues)
```

## Limites connues

- Authentification : en-têtes HTTP uniquement (Bearer, Basic encodé à la main, clé d'API…).
- Pas de filtres JSONPath avancés (`[?(@.x==1)]`, `*`).
- Testé : daemon (Python) en local avec faux serveur ; syntaxe PHP/JS vérifiée.
  **Non testé dans une instance Jeedom réelle** (interface, hooks `postAjax`, démarrage du daemon).

## Licence

GNU Affero General Public License v3.0 (voir `LICENSE`).
