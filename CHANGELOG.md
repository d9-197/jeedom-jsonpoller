# Changelog

## 0.3.0
- Nouvelle fenêtre de sélection des valeurs :
  - arbre repliable (premier niveau déplié), affichage par lots de 50 pour les grands tableaux (« afficher la suite » / « tout afficher ») ;
  - sélection multiple (cases à cocher) et bouton « Créer (N) » ; la fenêtre reste ouverte ; les chemins déjà utilisés sont grisés ;
  - dans un tableau, menu par valeur : désigner l'élément par son identifiant (`items[?(@.id==2)].v`, plus stable que l'index)
    ou calculer sur tous les éléments (`items[*].v` : somme, moyenne, minimum, maximum, nombre, liste…) ;
  - testeur de chemin en direct, calculé par le daemon (même logique que la scrutation) ;
  - filtre par type (nombres, booléens, textes, nulles), bouton « Recharger », « Copier le chemin », valeur complète au survol.
- Les textes JSON restent affichés entre guillemets (`"0.00"` n'est pas `0.00`).
- Test de la fenêtre dans un vrai navigateur (Chromium) en CI.
- Correction : « Copier le chemin » ne copiait rien quand Jeedom est servi en http (la fenêtre reprenait le focus).

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
