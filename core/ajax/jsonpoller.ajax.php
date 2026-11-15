<?php
try {
  require_once __DIR__ . '/../../../../core/php/core.inc.php';
  include_file('core', 'authentification', 'php');
  if (!isConnect('admin')) {
    throw new Exception(__('401 - Accès non autorisé', __FILE__));
  }
  ajax::init();

  if (init('action') == 'testUrl') {
    $headers = jsonpoller::parseHeaders(init('headers'));
    $res = jsonpoller::fetchUrl(
      init('url'), init('method', 'GET'), $headers, init('body'),
      (int) init('timeout', 10), init('verifySsl', 1) == 1
    );
    ajax::success($res);
  }
  throw new Exception(__('Aucune méthode correspondante à', __FILE__) . ' : ' . init('action'));
} catch (Exception $e) {
  ajax::error(displayException($e), $e->getCode());
}
