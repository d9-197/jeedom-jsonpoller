<?php
require __DIR__ . '/bootstrap.php';

/* Fabrique un équipement + commandes comme le ferait Jeedom. */
function makeEq($id, $conf = array(), $enabled = 1) {
  $eq = new jsonpoller();
  $eq->setId($id)->setName("eq$id")->setIsEnable($enabled);
  foreach ($conf as $k => $v) $eq->setConfiguration($k, $v);
  Stubs::$eqs[$id] = $eq;
  return $eq;
}
function makeCmd($eq, $id, $subType, $conf = array(), $logicalId = '') {
  $c = new jsonpollerCmd();
  $c->setId($id)->setEqLogic_id($eq->getId())->setType('info')->setSubType($subType)->setName("c$id")->setLogicalId($logicalId);
  foreach ($conf as $k => $v) $c->setConfiguration($k, $v);
  Stubs::$cmds[$id] = $c;
  return $c;
}

echo "convertValue\n";
$cases = array(
  // valeur, sous-type, format, attendu
  array('0.00', 'numeric', 'auto', 0.0),
  array('0.00', 'numeric', 'number', 0.0),
  array('1,5', 'numeric', 'number', 1.5),
  array(' 21.5 °C', 'numeric', 'number', 21.5),
  array('1e3', 'numeric', 'number', 1000.0),
  array('-4.2', 'numeric', 'auto', -4.2),
  array('abc', 'numeric', 'number', null),
  array('abc', 'numeric', 'auto', null),
  array(true, 'numeric', 'auto', 1),
  array(null, 'numeric', 'auto', null),
  array('on', 'binary', 'auto', 1),
  array('Off', 'binary', 'auto', 0),
  array('0.00', 'binary', 'auto', 0),
  array('x', 'binary', 'auto', null),
  array('2', 'binary', 'boolean', 1),
  array('off', 'numeric', 'boolean', 0),
  array(true, 'string', 'auto', 'true'),
  array(12, 'string', 'string', '12'),
  array(null, 'string', 'auto', ''),
  array(array('a' => 1), 'string', 'auto', '{"a":1}'),
  array('0.00', 'string', 'number', '0'),
);
foreach ($cases as $i => $c) {
  test('convertValue #' . $i . ' ' . json_encode($c[0]) . " {$c[1]}/{$c[2]}", function () use ($c) {
    same($c[3], jsonpoller::convertValue($c[0], $c[1], $c[2]));
  });
}

echo "applyScale\n";
$cases = array(
  array(3000, '0.001', '', '', 3.0),
  array(0.1, '3', '', '', 0.3),               // pas de bruit de flottants
  array(20, '', '', '', 20),                  // neutre : valeur inchangée (type conservé)
  array(20, '1', '0', '', 20),
  array(21.5, '', '-273.15', '', -251.65),
  array(300, '', '-273,15', '', 26.85),       // virgule décimale
  array(1234.5678, '', '', '2', 1234.57),
  array(1234.5678, '1', '0', '0', 1235.0),
  array(5, 'x', 'y', 'z', 5),                 // champs invalides = neutres
  array(5, '2', '', 'abc', 10.0),
  array(7, '', '', '-3', 7.0),                // décimales négatives ramenées à 0
  array(0.123456789012, '1', '0', '15', 0.123456789),  // plafonné à 10
  array(1, '0', '', '', 0.0),                 // un facteur 0 est un vrai facteur
  array('abc', '0.001', '', '', 'abc'),       // non numérique : inchangé
);
foreach ($cases as $i => $c) {
  test('applyScale #' . $i . ' ' . json_encode(array_slice($c, 0, 4)), function () use ($c) {
    same($c[4], jsonpoller::applyScale($c[0], $c[1], $c[2], $c[3]));
  });
}

echo "parseHeaders\n";
test('parseHeaders', function () {
  same(array('Authorization' => 'Bearer a:b', 'X-A' => '1'),
       jsonpoller::parseHeaders("Authorization: Bearer a:b\r\n\r\nlignesansdeuxpoints\n  X-A :  1 \n: vide"));
  same(array(), jsonpoller::parseHeaders(''));
});

echo "buildConfig\n";
test('buildConfig : équipements actifs avec URL, commandes avec chemin, bornes', function () {
  $a = makeEq(1, array('url' => 'http://x/a', 'interval' => 3, 'timeout' => 0, 'method' => 'post',
                       'headers' => "X-K: v", 'body' => '{}', 'verifySsl' => 0));
  makeCmd($a, 10, 'numeric', array('jsonPath' => ' data.t '));
  makeCmd($a, 11, 'string', array('jsonPath' => ''));                       // sans chemin : ignorée
  makeCmd($a, 12, 'numeric', array('jsonPath' => 'x'), '_http_status');      // interne : ignorée
  makeEq(2, array('url' => 'http://x/b'), 0);                                // désactivé
  makeEq(3, array('url' => ''));                                             // sans URL
  $cfg = jsonpoller::buildConfig();
  same(1, count($cfg));
  $e = $cfg[0];
  same(array(1, 'http://x/a', 'POST', 10, 1, false), array($e['id'], $e['url'], $e['method'], $e['interval'], $e['timeout'], $e['verify_ssl']));
  same(array('X-K' => 'v'), $e['headers']);
  same(array(array('id' => 10, 'path' => 'data.t')), $e['commands']);
});

echo "cycle de vie\n";
test('preSave impose la période minimale', function () {
  $eq = makeEq(1, array('url' => 'http://x', 'interval' => 2));
  $eq->preSave();
  same(10, $eq->getConfiguration('interval'));
  $eq->setConfiguration('interval', 45);
  $eq->preSave();
  same(45, $eq->getConfiguration('interval'));
});
test('createInternalCmds est idempotent', function () {
  $eq = makeEq(1, array('url' => 'http://x'));
  $eq->createInternalCmds();
  $n = count(Stubs::$cmds);
  same(4, $n);
  foreach (array('_http_status', '_error', '_last_ok', 'refresh') as $l) truthy($eq->getCmd(null, $l) !== null, "$l manquante");
  $eq->createInternalCmds();
  same($n, count(Stubs::$cmds));
});

echo "handleCallback\n";
test('succès : valeurs converties, mises à l\'échelle, statut et dernière réponse', function () {
  $eq = makeEq(1, array('url' => 'http://x'));
  $eq->createInternalCmds();
  makeCmd($eq, 10, 'numeric', array('jsonPath' => 'Irms', 'format' => 'number'));
  makeCmd($eq, 11, 'numeric', array('jsonPath' => 'p', 'factor' => '0.001', 'decimals' => '2'));
  makeCmd($eq, 12, 'binary', array('jsonPath' => 'on'));
  makeCmd($eq, 13, 'string', array('jsonPath' => 's'));
  jsonpoller::handleCallback(array('eqId' => 1, 'http' => 200, 'error' => '',
    'values' => array('10' => '0.00', '11' => 1234567, '12' => 'on', '13' => array('k' => 1))));
  same(0.0, $eq->updates[10]);
  same(1234.57, $eq->updates[11]);
  same(1, $eq->updates[12]);
  same('{"k":1}', $eq->updates[13]);
  same(200, $eq->updates['_http_status']);
  same('', $eq->updates['_error']);
  truthy(preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/', $eq->updates['_last_ok']) === 1, '_last_ok mal formée');
});
test('erreur : _last_ok non modifiée, erreur et code remontés', function () {
  $eq = makeEq(1, array('url' => 'http://x'));
  $eq->createInternalCmds();
  jsonpoller::handleCallback(array('eqId' => 1, 'http' => 503, 'error' => 'HTTP 503', 'retry_in' => 20, 'values' => array()));
  same(503, $eq->updates['_http_status']);
  same('HTTP 503', $eq->updates['_error']);
  truthy(!array_key_exists('_last_ok', $eq->updates), '_last_ok ne doit pas être mise à jour');
  truthy(strpos(implode("\n", Stubs::$logs), 'nouvel essai dans 20 s') !== false, 'délai non journalisé');
});
test('commande d\'un autre équipement ou valeur inconvertible : ignorée', function () {
  $eq = makeEq(1, array('url' => 'http://x'));
  $eq->createInternalCmds();
  $other = makeEq(2, array('url' => 'http://y'));
  makeCmd($other, 20, 'numeric');
  makeCmd($eq, 10, 'numeric');
  jsonpoller::handleCallback(array('eqId' => 1, 'http' => 200, 'error' => '', 'values' => array('20' => 5, '10' => 'abc', '999' => 1)));
  truthy(!array_key_exists(20, $eq->updates) && !array_key_exists(10, $eq->updates) && !array_key_exists(999, $eq->updates));
  truthy(strpos(implode("\n", Stubs::$logs), 'incompatible') !== false, 'avertissement attendu');
});
test('équipement inconnu : sans effet ; commande interne créée à la volée', function () {
  jsonpoller::handleCallback(array('eqId' => 4242, 'http' => 200, 'values' => array()));
  $eq = makeEq(1, array('url' => 'http://x'));
  jsonpoller::handleCallback(array('eqId' => 1, 'http' => 200, 'error' => '', 'values' => array()));
  truthy($eq->getCmd(null, '_last_ok') !== null, '_last_ok doit être créée pour un équipement existant');
});

echo "sendToDaemon\n";
test('daemon absent : exception explicite', function () {
  Stubs::$config['socketport'] = 1; // rien n'écoute
  throws(function () { jsonpoller::sendToDaemon(array('cmd' => 'ping')); }, 'injoignable');
});

done();
