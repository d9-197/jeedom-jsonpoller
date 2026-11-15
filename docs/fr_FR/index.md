# Plugin JSON Poller

Ce plugin interroge périodiquement des URLs retournant du JSON et remonte des valeurs
choisies dans des commandes info.

## Configuration

Démarrer le daemon depuis la page de configuration du plugin. Le port (55081 par défaut)
n'est utilisé qu'en local (127.0.0.1).

## Équipement

- **URL** et **période de scrutation** (minimum 10 s).
- En-têtes HTTP, méthode GET/POST, corps, vérification SSL.
- Le bouton « Tester l'URL et choisir des valeurs » liste les valeurs du JSON ; un clic crée la commande.

## Commandes

Chaque commande info a un *chemin dans le JSON* : `data.temp`, `items[0].value`, `$.a["x.y"]`.
Les erreurs de chemin ou HTTP sont visibles dans le log `jsonpoller` et dans les commandes « Code HTTP » / « Erreur ».

## Authentification et étiquettes

Basic ou Bearer dans l'équipement. L'URL, les en-têtes, le corps et les identifiants acceptent `#variable(nom)#` et
`#[Objet][Équipement][Commande]#` (prise en compte sous 1 minute).

## Plusieurs valeurs

Un chemin avec joker (`items[*].v`) ou filtre (`items[?(@.id==3)].v`) peut désigner plusieurs valeurs : le menu
« Plusieurs valeurs » de la commande choisit première, dernière, somme, moyenne, minimum, maximum, nombre ou liste JSON.
