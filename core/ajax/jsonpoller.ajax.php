<?php
try {
  require_once __DIR__ . '/../../../../core/php/core.inc.php';
  include_file('core', 'authentification', 'php');
  if (!isConnect('admin')) {
    throw new Exception(__('401 - Accès non autorisé', __FILE__));
  }
  ajax::init();

  if (init('action') == 'testUrl') {
    $req = jsonpoller::buildRequest(array(
      'url' => init('url'), 'method' => init('method', 'GET'), 'headers' => init('headers'), 'body' => init('body'),
      'authType' => init('authType', 'none'), 'authUser' => init('authUser'),
      'authPassword' => init('authPassword'), 'authToken' => init('authToken'),
    ));
    $res = jsonpoller::fetchUrl(
      $req['url'], $req['method'], $req['headers'], $req['body'],
      (int) init('timeout', 10), init('verifySsl', 1) == 1
    );
    ajax::success($res);
  }
  if (init('action') == 'evalPath') {
    ajax::success(jsonpoller::evalPath(init('data'), init('path'), init('agg', 'first')));
  }
  throw new Exception(__('Aucune méthode correspondante à', __FILE__) . ' : ' . init('action'));
} catch (Exception $e) {
  ajax::error(displayException($e), $e->getCode());
}
