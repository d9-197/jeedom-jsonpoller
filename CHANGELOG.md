# Changelog

## 0.2.0
- Authentification dédiée : Basic (utilisateur / mot de passe) et Bearer (jeton).
- Étiquettes Jeedom dans l'URL, les en-têtes, le corps et les identifiants : `#variable(nom)#` et `#[Objet][Équipement][Commande]#`
  (prises en compte au plus tard 1 minute après un changement).
- Chemins JSON avancés : jokers (`items[*].v`, `m.*.t`) et filtres (`items[?(@.id==3)].v`), avec agrégation par commande
  (première, dernière, somme, moyenne, minimum, maximum, nombre, liste JSON).
- Sécurité : la clé API n'est plus passée en ligne de commande au daemon (fichier 0600 supprimé après lecture) ni dans l'URL du
  callback (en-tête `X-Jeedom-Apikey`) ; elle n'apparaît plus dans le log.
- Traduction anglaise (`en_US`), tests automatiques de l'interface JavaScript.
- Correction : un chemin comme `valeur[0]` sur une chaîne renvoie maintenant une erreur au lieu de son premier caractère.

## 0.1.0
- Daemon de scrutation d'URLs JSON (période minimale 10 s), commandes info par chemin JSON, explorateur de JSON.
- Format des valeurs (automatique, nombre, booléen, texte), facteur / décalage / décimales.
- Backoff sur échec, commande « Dernière réponse OK », envoi différentiel, surveillance et redémarrage du daemon.
- Tests automatiques (Python, PHP, intégration) et CI GitHub Actions.
