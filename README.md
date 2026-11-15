# JSON Poller — plugin Jeedom

[![CI](https://github.com/d9-197/jeedom-jsonpoller/actions/workflows/ci.yml/badge.svg)](https://github.com/d9-197/jeedom-jsonpoller/actions/workflows/ci.yml)

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
| `items[*].v` · `m.*.t` | **joker** : tous les éléments d'un tableau / toutes les valeurs d'un objet |
| `items[?(@.id==3)].v` | **filtre** : éléments dont `@.id` vaut 3 |
| *(vide)* | JSON entier |

Filtres : `@.clé` (existence) ou `@.clé OP valeur` avec `==  !=  <  <=  >  >=` ; la valeur est un nombre, `true`/`false`/`null`
ou un texte entre `"` ou `'` ; `"2"` et `2` sont considérés égaux. Les éléments qui n'ont pas la clé ne correspondent pas.
Limites : pas de jokers ni de filtres imbriqués dans un filtre ; une valeur de filtre ne peut pas contenir `)]`.

Quand un chemin avec joker ou filtre désigne **plusieurs valeurs**, le menu *Plusieurs valeurs* de la commande choisit :
première, dernière, somme, moyenne, minimum, maximum, nombre, ou liste JSON. Les textes numériques (`"1,5"`) sont acceptés
pour les calculs ; une sélection vide donne une erreur dans le log, sauf pour *nombre* (0) et *liste* (`[]`).
Les objets/tableaux sélectionnés sont remontés en texte JSON. Les booléens sont convertis en 0/1 pour une commande
binaire ou numérique.

### Authentification et étiquettes Jeedom

- **Authentification** : *Basic* (utilisateur / mot de passe) ou *Bearer* (jeton). Un en-tête `Authorization` saisi à la main
  dans *En-têtes HTTP* est prioritaire. Les identifiants sont stockés dans la configuration de l'équipement
  (base Jeedom, **en clair**, comme le reste de la configuration ; ils figurent donc dans les sauvegardes) mais ne sont
  jamais écrits dans les logs du plugin.
- **Étiquettes** acceptées dans l'URL, les en-têtes, le corps et les identifiants : `#variable(nom)#` (variable de scénario) et
  `#[Objet][Équipement][Commande]#` ou `#id#` (valeur d'une commande). Utile pour un jeton renouvelé ou une adresse dynamique.
  Les valeurs sont insérées telles quelles (sans encodage d'URL) et sans retour à la ligne. Un changement est transmis au
  daemon **au plus tard 1 minute plus tard** (cron). Une variable inexistante donne une chaîne vide.

### Format de la valeur

Chaque commande a une option *Format* : **automatique** (selon le sous-type), **nombre** (`"0.00"`, `"1,5"` ou `"21.5 °C"` deviennent des nombres), **booléen** (`true`/`on`/`yes`/`1` → 1) ou **texte**. L'explorateur de JSON détecte les nombres écrits entre guillemets et préconfigure le format *nombre*.

### Facteur, décalage, décimales

Pour une commande numérique : valeur finale = **valeur × facteur + décalage**, puis arrondi au nombre de **décimales**
demandé (0 à 10). Ex. : facteur `0.001` (mW → W), décalage `-273.15` (K → °C). Champs vides ou invalides = neutres ;
la virgule décimale est acceptée. Sans décimales indiquées, la valeur est arrondie à 10 décimales pour éliminer le bruit
des flottants. L'ordre est : format (texte → nombre) puis facteur/décalage.
Jeedom propose aussi un calcul natif (*Configuration avancée de la commande → Calcul et arrondi*, formule avec `#value#`) :
n'utilisez pas les deux sur la même commande, le calcul serait appliqué deux fois.

Commandes créées automatiquement : *Code HTTP*, *Erreur*, *Dernière réponse OK* (infos), *Rafraîchir* (action).

*Dernière réponse OK* contient la date/heure (`AAAA-MM-JJ hh:mm:ss`, heure du serveur) de la dernière scrutation réussie ;
elle n'est pas mise à jour en cas d'erreur (et, en fonctionnement stable, au plus toutes les 60 s : voir *Envoi
différentiel*), ce qui permet de détecter une source muette
(ex. dans un scénario : `time() - strtotime(#[Objet][Équipement][Dernière réponse OK]#) > 300`).
Sur un équipement existant, la commande apparaît à la première réponse du daemon après la mise à jour.

### Échecs et espacement des essais

Si une source ne répond pas (réseau, timeout, HTTP ≥ 400, réponse non JSON), le daemon double le délai à chaque
échec consécutif : période, 2×, 4×, 8×… plafonné à **5 minutes** (jamais en dessous de la période configurée).
Dès qu'une réponse valide arrive, la période normale reprend. Le bouton *Rafraîchir* force un essai immédiat.
Seul le premier échec est journalisé en `warning` (les suivants en `debug`) ; le retour à la normale est journalisé en `info`.
Un chemin JSON introuvable n'est pas un échec de la source : la période n'est pas modifiée.

## Envoi différentiel

Le daemon n'appelle Jeedom que lorsqu'il y a quelque chose de nouveau : une valeur modifiée (seules les valeurs
modifiées sont envoyées), un changement d'état (succès ↔ erreur, code HTTP, message d'erreur), ou au moins **toutes les
60 s** un envoi complet (état + toutes les valeurs, qui sert aussi de filet de sécurité contre une dérive). Un envoi
complet est aussi fait après chaque changement de configuration et à chaque clic sur *Rafraîchir*. Si l'appel à Jeedom
échoue, rien n'est considéré comme envoyé : tout est renvoyé au cycle suivant.
Conséquence : une valeur qui change est transmise dès la scrutation suivante (pas de retard), mais la commande
*Dernière réponse OK* peut avoir jusqu'à 60 s de résolution ; réglez les seuils d'alerte au-dessus de 2 minutes.

## Surveillance du daemon

- **Processus disparu** : relancé par le core Jeedom (gestion automatique, activée par défaut).
- **Daemon vivant mais en défaut** : une vérification s'exécute chaque minute (cron Jeedom). Elle interroge le daemon
  (`status`) et considère qu'il est en défaut s'il ne répond pas dans les 5 s, si sa boucle de scrutation est figée
  depuis plus de 30 s, ou si une scrutation dure anormalement longtemps (> 3 × timeout + 30 s).
  Après **2 constats consécutifs** (≈ 2 min), le daemon est redémarré, un message est ajouté au centre de messages
  et l'événement est journalisé en `error`. Rien n'est redémarré si la gestion automatique est désactivée
  (le défaut est alors seulement journalisé).
- **Configuration désynchronisée** : si la liste des équipements connus du daemon diffère de celle de Jeedom
  (daemon relancé hors Jeedom, configuration perdue), la configuration est renvoyée automatiquement.
- **Délai total** : une requête HTTP est interrompue au bout de *timeout* secondes au total, même si la source
  répond au compte-gouttes (le timeout du socket, lui, ne s'applique qu'à chaque opération réseau).

Limite : la résolution DNS n'est pas couverte par le timeout ; un DNS qui ne répond pas peut bloquer une scrutation,
ce que la surveillance détecte au bout de 3 × timeout + 30 s et traite par un redémarrage.

## Architecture

```
Jeedom (PHP) ──socket TCP 127.0.0.1:55081 (config, refresh)──▶ jsonpollerd.py
Jeedom (PHP) ◀──POST core/php/jeeJsonpoller.php?apikey=…──────  (valeurs lues)
```

## Limites connues

- Pas d'authentification OAuth, ni de certificats clients.
- Filtres limités à une comparaison simple (pas de `&&`/`||`, pas de fonctions).
- Testé : daemon (Python) en local avec faux serveur ; syntaxe PHP/JS vérifiée.
  **Non testé dans une instance Jeedom réelle** (interface, hooks `postAjax`, démarrage du daemon).

## Tests

```bash
tests/run_all.sh          # tout (~40 s) : mêmes vérifications que la CI
tests/run_all.sh quick    # sans le test d'intégration PHP (~10 s)
```

Prérequis : `python3` (≥ 3.9), `php` (≥ 7.4, extension `posix`) et `node` (≥ 18). Aucune dépendance à installer (ni Composer ni pip).

| Suite | Contenu |
|---|---|
| `tests/python/` | daemon : chemins JSON (jokers, filtres, agrégations), backoff, requêtes HTTP (délai total, gros corps, POST…), envoi différentiel, protocole socket, clé API, processus complet ; couverture des traductions ; cohérence des chemins générés par l'interface JS |
| `tests/js/` | interface : génération des chemins, détection du sous-type, lignes du tableau des commandes (faux jQuery, `node --test`) |
| `tests/php/unit.php` | conversions de format, facteur/décalage, authentification, étiquettes Jeedom, configuration envoyée au daemon, callback, commandes internes |
| `tests/php/integration.php` | le **vrai daemon** piloté par la vraie classe PHP : démarrage, clé API absente de la ligne de commande et des logs, jeton Bearer et variables, resynchronisation, gel + redémarrage automatique, arrêt |

Les tests PHP utilisent un faux cœur Jeedom (`tests/php/stubs.php`) : ils vérifient la logique du plugin, **pas** l'intégration
dans un vrai Jeedom (interface, cron, base de données). La CI GitHub (`.github/workflows/ci.yml`) les exécute sur Python 3.9/3.11/3.12
et PHP 7.4/8.1/8.3 à chaque push et pull request.

## Traductions

Français (langue du code) et anglais (`core/i18n/en_US.json`). Un test vérifie que chaque texte `{{...}}` / `__('...', __FILE__)`
a une traduction (et qu'aucune n'est orpheline) : après avoir ajouté un texte, ajoutez sa traduction.

## Licence

GNU Affero General Public License v3.0 (voir `LICENSE`).
