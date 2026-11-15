<?php
/* Callback appelé par le daemon pour remonter les valeurs. */
require_once __DIR__ . '/../../../../core/php/core.inc.php';

if (!jeedom::apiAccess(init('apikey'), 'jsonpoller')) {
  echo 'Clé API non valide';
  die();
}
$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
  die();
}
jsonpoller::handleCallback($data);
echo 'ok';
