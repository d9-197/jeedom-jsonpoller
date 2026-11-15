<?php
/** Faux cœur Jeedom : juste ce dont le plugin a besoin, avec enregistrement des appels. */

function __($s, $f = null) { return $s; }

class Stubs {
  public static $eqs = array();     // id => eqLogic
  public static $cmds = array();    // id => cmd
  public static $logs = array();
  public static $messages = array();
  public static $cache = array();
  public static $config = array();
  public static $nextId = 100;
  public static $vars = array();       // variables de scénario
  public static $cmdValues = array();  // valeur des commandes, par id ou par #[Objet][Équipement][Commande]#
  public static function reset() {
    self::$eqs = self::$cmds = self::$logs = self::$messages = self::$cache = self::$vars = self::$cmdValues = array();
    self::$config = array('socketport' => 55097);
    self::$nextId = 100;
  }
}

class cmd {
  private $d = array();
  public function __call($m, $a) {
    $p = substr($m, 0, 3);
    $k = lcfirst(substr($m, 3));
    if ($p === 'set') { $this->d[$k] = $a[0]; return $this; }
    if ($p === 'get') {
      if ($k === 'configuration') {
        $conf = $this->d['configuration'] ?? array();
        return count($a) ? ($conf[$a[0]] ?? ($a[1] ?? '')) : $conf;
      }
      return $this->d[$k] ?? null;
    }
    throw new Exception("cmd::$m non simulé");
  }
  public function setConfiguration($k, $v) { $this->d['configuration'][$k] = $v; return $this; }
  public function save() {
    if (empty($this->d['id'])) { $this->d['id'] = ++Stubs::$nextId; }
    Stubs::$cmds[$this->d['id']] = $this;
  }
  public static function byId($id) { return Stubs::$cmds[$id] ?? null; }
  /** Simule cmd::cmdToValue : #42# et #[Objet][Équipement][Commande]# remplacés par la valeur de la commande. */
  public static function cmdToValue($text) {
    return preg_replace_callback('/#(\d+|\[[^#]+\])#/', function ($m) {
      return array_key_exists($m[1], Stubs::$cmdValues) ? (string) Stubs::$cmdValues[$m[1]] : $m[0];
    }, $text);
  }
  public function execute($_options = array()) {}
}

class eqLogic {
  private $d = array();
  public $updates = array();   // [logicalId|cmdId => valeur] des checkAndUpdateCmd
  public function __call($m, $a) {
    $p = substr($m, 0, 3);
    $k = lcfirst(substr($m, 3));
    if ($p === 'set') { $this->d[$k] = $a[0]; return $this; }
    if ($p === 'get') { return $this->d[$k] ?? null; }
    throw new Exception("eqLogic::$m non simulé");
  }
  public function setConfiguration($k, $v) { $this->d['configuration'][$k] = $v; return $this; }
  public function getConfiguration($k = '', $default = '') {
    if ($k === '') { return $this->d['configuration'] ?? array(); } // comme Jeedom : toute la configuration
    return $this->d['configuration'][$k] ?? $default;
  }
  public function getEqType_name() { return 'jsonpoller'; }
  public function getHumanName() { return '[Objet][' . ($this->d['name'] ?? '?') . ']'; }
  public function save() {
    if (empty($this->d['id'])) { $this->d['id'] = ++Stubs::$nextId; }
    Stubs::$eqs[$this->d['id']] = $this;
    $this->postSave();
  }
  public function getCmd($type = null, $logicalId = null) {
    $r = array();
    foreach (Stubs::$cmds as $c) {
      if ($c->getEqLogic_id() != $this->getId()) continue;
      if ($logicalId !== null) {
        if ($c->getLogicalId() === $logicalId) return $c;
        continue;
      }
      if ($type === null || $c->getType() === $type) $r[] = $c;
    }
    return $logicalId !== null ? null : $r;
  }
  public function checkAndUpdateCmd($c, $value) {
    $key = is_object($c) ? $c->getId() : $c;
    $this->updates[$key] = $value;
    return true;
  }
  public static function byId($id) { return Stubs::$eqs[$id] ?? null; }
  public static function byType($t, $onlyEnabled = false) {
    return array_values(array_filter(Stubs::$eqs, function ($e) use ($onlyEnabled) {
      return !$onlyEnabled || $e->getIsEnable();
    }));
  }
  public function postSave() {}
}

class log {
  public static function add($c, $level, $msg, $k = '') { Stubs::$logs[] = "$level: $msg"; }
  public static function convertLogLevel($l) { return 'debug'; }
  public static function getLogLevel($c) { return 100; }
  public static function getPathToLog($n) { return SANDBOX . '/tmp/' . $n . '.log'; }
}
class config { public static function byKey($k, $p, $d = null) { return Stubs::$config[$k] ?? $d; } }
class jeedom {
  public static function getApiKey($p) { return 'KEY'; }
  public static function getTmpFolder($p) { return SANDBOX . '/tmp'; }
}
class network { public static function getNetworkAccess($a, $b) { return Stubs::$config['callbackBase'] ?? 'http://127.0.0.1:1'; } }
class system { public static function kill($x) { if (is_numeric($x)) { posix_kill((int) $x, 9); } } }
class message {
  public static function add($p, $m) { Stubs::$messages[] = $m; }
  public static function removeAll($p, $l = '') {}
}
class CacheItem {
  private $v;
  public function __construct($v) { $this->v = $v; }
  public function getValue($d = null) { return $this->v === null ? $d : $this->v; }
}
class cache {
  public static function byKey($k) { return new CacheItem(Stubs::$cache[$k] ?? null); }
  public static function set($k, $v) { Stubs::$cache[$k] = $v; }
}

class dataStore {
  private $v;
  public function __construct($v) { $this->v = $v; }
  public function getValue($d = '') { return $this->v; }
  public static function byTypeLinkIdKey($type, $linkId, $key) {
    return array_key_exists($key, Stubs::$vars) ? new dataStore(Stubs::$vars[$key]) : null;
  }
}
