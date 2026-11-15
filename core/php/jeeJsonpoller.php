<?php
/* Callback appelé par le daemon pour remonter les valeurs. */
require_once __DIR__ . '/../../../../core/php/core.inc.php';

// Clé API dans un en-tête (une clé dans l'URL finirait dans les journaux d'accès du serveur web)
$apikey = $_SERVER['HTTP_X_JEEDOM_APIKEY'] ?? init('apikey');
if (!jeedom::apiAccess($apikey, 'jsonpoller')) {
  echo 'Clé API non valide';
  die();
}
$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
  die();
}
jsonpoller::handleCallback($data);
echo 'ok';
