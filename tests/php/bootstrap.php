<?php
/**
 * Bootstrap des tests PHP : mini-framework + faux "cœur Jeedom".
 * Compatible PHP 7.4 à 8.x, aucune dépendance (pas de Composer).
 *
 * La classe du plugin fait require_once '../../../../core/php/core.inc.php' : on reconstruit donc,
 * dans un dossier temporaire, l'arborescence  <jeedom>/plugins/jsonpoller/  avec une copie de la classe.
 */
error_reporting(E_ALL);
set_error_handler(function ($no, $str, $file, $line) {
  if (!(error_reporting() & $no)) {
    return false; // erreur volontairement supprimée par l'opérateur @
  }
  throw new ErrorException($str, 0, $no, $file, $line); // tout warning/notice/deprecated devient un échec
});

define('REPO', realpath(__DIR__ . '/../..'));
define('SANDBOX', sys_get_temp_dir() . '/jsonpoller-test-' . getmypid());
@mkdir(SANDBOX . '/core/php', 0777, true);
@mkdir(SANDBOX . '/plugins/jsonpoller/core/class', 0777, true);
@mkdir(SANDBOX . '/tmp', 0777, true);
copy(REPO . '/core/class/jsonpoller.class.php', SANDBOX . '/plugins/jsonpoller/core/class/jsonpoller.class.php');
if (!file_exists(SANDBOX . '/plugins/jsonpoller/resources')) {
  symlink(REPO . '/resources', SANDBOX . '/plugins/jsonpoller/resources');
}
register_shutdown_function(function () {
  exec('rm -rf ' . escapeshellarg(SANDBOX));
});
file_put_contents(SANDBOX . '/core/php/core.inc.php', '<?php require ' . var_export(__DIR__ . '/stubs.php', true) . ';');
require SANDBOX . '/plugins/jsonpoller/core/class/jsonpoller.class.php';

// ---------------------------------------------------------------- mini-framework
$GLOBALS['T'] = array('pass' => 0, 'fail' => 0);

function test($name, $fn) {
  if (!defined('KEEP_STATE')) {
    Stubs::reset(); // tests unitaires : état vierge à chaque test (l'intégration enchaîne un scénario)
  }
  try {
    $fn();
    $GLOBALS['T']['pass']++;
    echo "  ok   $name\n";
  } catch (Throwable $e) {
    $GLOBALS['T']['fail']++;
    echo "  FAIL $name\n       " . get_class($e) . ': ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
  }
}

function same($expected, $actual, $msg = '') {
  if ($expected !== $actual) {
    throw new Exception(($msg ? "$msg : " : '') . 'attendu ' . var_export($expected, true) . ', obtenu ' . var_export($actual, true));
  }
}

function truthy($v, $msg = 'condition fausse') {
  if (!$v) throw new Exception($msg);
}

function throws($fn, $contains = '') {
  try {
    $fn();
  } catch (Exception $e) {
    if ($contains !== '' && strpos($e->getMessage(), $contains) === false) {
      throw new Exception("exception '" . $e->getMessage() . "' ne contient pas '$contains'");
    }
    return;
  }
  throw new Exception('exception attendue');
}

function done() {
  $t = $GLOBALS['T'];
  echo "\n{$t['pass']} réussi(s), {$t['fail']} échec(s)\n";
  exit($t['fail'] > 0 ? 1 : 0);
}
