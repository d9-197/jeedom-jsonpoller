<?php
/**
 * Intégration : le vrai daemon Python, piloté par la vraie classe PHP (démarrage, flux de valeurs,
 * resynchronisation, surveillance + redémarrage, arrêt). Nécessite python3 et l'extension posix.
 */
define('KEEP_STATE', true);
require __DIR__ . '/bootstrap.php';
Stubs::reset();

function freePort() {
  $s = stream_socket_server('tcp://127.0.0.1:0', $e, $m);
  $name = stream_socket_get_name($s, false);
  fclose($s);
  return (int) substr($name, strrpos($name, ':') + 1);
}
function waitFor($fn, $timeout, $what) {
  $end = microtime(true) + $timeout;
  while (microtime(true) < $end) {
    $r = $fn();
    if ($r) return $r;
    usleep(100000);
  }
  throw new Exception("délai dépassé en attendant : $what");
}
function pidOf() { return (int) trim((string) @file_get_contents(SANDBOX . '/tmp/deamon.pid')); }
function status() { return jsonpoller::sendToDaemon(array('cmd' => 'status')); }
function sinkLines() {
  $f = SANDBOX . '/sink.jsonl';
  if (!file_exists($f)) return array();
  return array_map(function ($l) { return json_decode($l, true); }, array_filter(explode("\n", file_get_contents($f))));
}
function addEq($id) {
  $eq = new jsonpoller();
  $eq->setId($id)->setName("eq$id")->setIsEnable(1);
  $eq->setConfiguration('url', Stubs::$config['sourceUrl']);
  $eq->setConfiguration('interval', 10);
  Stubs::$eqs[$id] = $eq;
  $c = new jsonpollerCmd();
  $c->setId($id * 10)->setEqLogic_id($id)->setType('info')->setSubType('numeric')->setName('irms');
  $c->setConfiguration('jsonPath', 'Irms');
  Stubs::$cmds[$id * 10] = $c;
}

$sourcePort = freePort();
$sinkPort = freePort();
Stubs::$config['socketport'] = freePort();
Stubs::$config['callbackBase'] = "http://127.0.0.1:$sinkPort";
Stubs::$config['sourceUrl'] = "http://127.0.0.1:$sourcePort/";
file_put_contents(SANDBOX . '/source.json', '{"Irms":"1.50","power":"0.00"}');

$services = proc_open(
  array('python3', REPO . '/tests/support/fake_services.py', '--dir', SANDBOX, '--source-port', (string) $sourcePort, '--sink-port', (string) $sinkPort),
  array(0 => array('file', '/dev/null', 'r'), 1 => array('file', '/dev/null', 'w'), 2 => array('file', '/dev/null', 'w')),
  $pipes
);
register_shutdown_function(function () use ($services) {
  if (pidOf() > 0) { @posix_kill(pidOf(), 9); }
  proc_terminate($services);
});
waitFor(function () use ($sourcePort) { return @fsockopen('127.0.0.1', $sourcePort); }, 10, 'services factices');

echo "daemon réel\n";
addEq(1);

test('deamon_start lance le daemon, lui envoie la configuration, les valeurs arrivent', function () {
  truthy(jsonpoller::deamon_start() === true, 'deamon_start doit réussir');
  same('ok', jsonpoller::deamon_info()['state']);
  same(array(1), status()['equipments']);
  $first = waitFor(function () { $l = sinkLines(); return $l ? $l[0] : null; }, 15, 'premier callback');
  same(1, $first['eqId']);
  same(200, $first['http']);
  same(array('10' => '1.50'), $first['values']);
  same('', $first['error']);
});

test('watchdog : daemon sain et configuration alignée => aucune action', function () {
  Stubs::$logs = array();
  jsonpoller::watchdog();
  same(array(), Stubs::$logs);
});

test('watchdog : équipement ajouté côté Jeedom => configuration renvoyée', function () {
  addEq(2);
  Stubs::$logs = array();
  jsonpoller::watchdog();
  truthy(strpos(implode("\n", Stubs::$logs), 'désynchronisée') !== false, 'resynchronisation non journalisée');
  same(array(1, 2), status()['equipments']);
});

test('watchdog : daemon gelé => 1er passage avertit, 2e passage redémarre (nouveau pid + message)', function () {
  $old = pidOf();
  truthy($old > 0, 'pid inconnu');
  posix_kill($old, 19); // SIGSTOP : le processus existe mais ne répond plus
  Stubs::$logs = array();
  jsonpoller::watchdog();
  same(array(), Stubs::$messages, 'pas de redémarrage au premier constat');
  truthy(strpos(implode("\n", Stubs::$logs), '(1/2)') !== false, 'avertissement 1/2 attendu');
  jsonpoller::watchdog();
  $new = pidOf();
  truthy($new > 0 && $new !== $old, 'nouveau pid attendu');
  truthy(!@posix_getsid($old), 'ancien processus encore vivant');
  same(1, count(Stubs::$messages), 'message Jeedom attendu');
  same(array(1, 2), status()['equipments'], 'la configuration doit être renvoyée au nouveau daemon');
});

test('watchdog : gestion automatique désactivée => pas de redémarrage', function () {
  Stubs::$config['deamonAutoMode'] = 0;
  $pid = pidOf();
  posix_kill($pid, 19);
  Stubs::$messages = array();
  jsonpoller::watchdog();
  jsonpoller::watchdog();
  same($pid, pidOf());
  same(array(), Stubs::$messages);
  posix_kill($pid, 18); // SIGCONT
  Stubs::$config['deamonAutoMode'] = 1;
});

test('deamon_stop arrête le daemon', function () {
  jsonpoller::deamon_stop();
  same('nok', jsonpoller::deamon_info()['state']);
});

done();
