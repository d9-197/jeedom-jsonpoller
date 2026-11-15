<?php
require_once __DIR__ . '/../../../../core/php/core.inc.php';

class jsonpoller extends eqLogic {

  const MIN_INTERVAL = 10;
  const AGGREGATIONS = array('first', 'last', 'sum', 'avg', 'min', 'max', 'count', 'list');

  /* ------------------------------------------------------------------ */
  /* Daemon                                                              */
  /* ------------------------------------------------------------------ */

  public static function deamon_info() {
    $return = array('log' => __CLASS__ . '_daemon', 'state' => 'nok', 'launchable' => 'ok', 'launchable_message' => '');
    $pid_file = jeedom::getTmpFolder(__CLASS__) . '/deamon.pid';
    if (file_exists($pid_file)) {
      $pid = (int) trim(file_get_contents($pid_file));
      if ($pid > 0 && @posix_getsid($pid)) {
        $return['state'] = 'ok';
      } else {
        @unlink($pid_file);
      }
    }
    $python = trim((string) shell_exec('command -v python3'));
    if ($python == '') {
      $return['launchable'] = 'nok';
      $return['launchable_message'] = __('python3 est introuvable sur le système', __FILE__);
    }
    return $return;
  }

  public static function deamon_start() {
    self::deamon_stop();
    $info = self::deamon_info();
    if ($info['launchable'] != 'ok') {
      throw new Exception(__('Veuillez vérifier la configuration', __FILE__) . ' : ' . $info['launchable_message']);
    }
    $path = realpath(__DIR__ . '/../../resources/jsonpollerd');
    $cmd = 'python3 ' . escapeshellarg($path . '/jsonpollerd.py');
    $cmd .= ' --loglevel ' . escapeshellarg(log::convertLogLevel(log::getLogLevel(__CLASS__)));
    $cmd .= ' --socketport ' . (int) self::getPort();
    $cmd .= ' --callback ' . escapeshellarg(network::getNetworkAccess('internal', 'proto:127.0.0.1:port:comp') . '/plugins/jsonpoller/core/php/jeeJsonpoller.php');
    // La clé API n'est pas passée en argument (visible dans `ps` et dans le log) : fichier 0600 lu puis supprimé par le daemon
    $keyFile = jeedom::getTmpFolder(__CLASS__) . '/apikey';
    $oldUmask = umask(0077);
    file_put_contents($keyFile, jeedom::getApiKey(__CLASS__));
    umask($oldUmask);
    @chmod($keyFile, 0600);
    $cmd .= ' --apikey-file ' . escapeshellarg($keyFile);
    $cmd .= ' --pid ' . escapeshellarg(jeedom::getTmpFolder(__CLASS__) . '/deamon.pid');
    log::add(__CLASS__, 'info', 'Lancement du daemon : ' . $cmd);
    exec($cmd . ' >> ' . log::getPathToLog(__CLASS__ . '_daemon') . ' 2>&1 &');

    $i = 0;
    while ($i < 30) {
      if (self::deamon_info()['state'] == 'ok') {
        break;
      }
      sleep(1);
      $i++;
    }
    if ($i >= 30) {
      log::add(__CLASS__, 'error', 'Impossible de lancer le daemon, consultez le log ' . __CLASS__ . '_daemon', 'unableStartDeamon');
      return false;
    }
    message::removeAll(__CLASS__, 'unableStartDeamon');
    // le socket peut mettre un instant à être à l'écoute
    for ($try = 0; $try < 10; $try++) {
      try {
        self::sendConfig();
        return true;
      } catch (Exception $e) {
        sleep(1);
      }
    }
    log::add(__CLASS__, 'error', 'Daemon lancé mais injoignable sur le port ' . self::getPort());
    return false;
  }

  public static function deamon_stop() {
    $pid_file = jeedom::getTmpFolder(__CLASS__) . '/deamon.pid';
    if (file_exists($pid_file)) {
      $pid = (int) trim(file_get_contents($pid_file));
      if ($pid > 0) {
        system::kill($pid);
      }
      @unlink($pid_file);
    }
    system::kill('jsonpollerd.py');
    sleep(1);
  }

  public static function getPort() {
    return (int) config::byKey('socketport', __CLASS__, 55081);
  }

  /** Envoie un message JSON (une ligne) au daemon et retourne sa réponse. */
  public static function sendToDaemon($_payload) {
    $_payload['apikey'] = jeedom::getApiKey(__CLASS__);
    $fp = @stream_socket_client('tcp://127.0.0.1:' . self::getPort(), $errno, $errstr, 3);
    if (!$fp) {
      throw new Exception("Daemon injoignable ($errstr)");
    }
    stream_set_timeout($fp, 5);
    fwrite($fp, json_encode($_payload) . "\n");
    $reply = fgets($fp);
    $timedOut = !empty(stream_get_meta_data($fp)['timed_out']);
    fclose($fp);
    if ($timedOut) {
      throw new Exception('délai dépassé, le daemon ne répond pas');
    }
    $reply = json_decode((string) $reply, true);
    if (!is_array($reply) || empty($reply['ok'])) {
      throw new Exception('Réponse du daemon invalide : ' . json_encode($reply));
    }
    return $reply;
  }

  /** Pousse la configuration de tous les équipements actifs au daemon. */
  public static function sendConfig() {
    $equipments = self::buildConfig();
    $reply = self::sendToDaemon(array('cmd' => 'config', 'equipments' => $equipments));
    cache::set('jsonpoller::config::hash', self::configHash($equipments));
    return $reply;
  }

  public static function configHash($_equipments) {
    return md5(json_encode($_equipments));
  }

  /* ------------------------------------------------------------------ */
  /* Requête : authentification dédiée et étiquettes Jeedom              */
  /* ------------------------------------------------------------------ */

  /**
   * Remplace les étiquettes Jeedom d'un texte : #variable(nom)# (variables de scénario),
   * #[Objet][Équipement][Commande]# et #id# (valeur d'une commande). Les retours à la ligne
   * sont supprimés des valeurs insérées (pas d'injection d'en-têtes).
   */
  public static function resolveTags($_text) {
    $_text = (string) $_text;
    if (strpos($_text, '#') === false) {
      return $_text;
    }
    $_text = preg_replace_callback('/#variable\(([^)]+)\)#/', function ($m) {
      $d = dataStore::byTypeLinkIdKey('scenario', -1, trim($m[1]));
      return is_object($d) ? preg_replace('/[\r\n]+/', '', (string) $d->getValue('')) : '';
    }, $_text);
    if (strpos($_text, '#') !== false) {
      try {
        $_text = cmd::cmdToValue($_text);
      } catch (Exception $e) {
        log::add(__CLASS__, 'warning', 'Étiquette Jeedom non résolue : ' . $e->getMessage());
      }
    }
    return $_text;
  }

  /**
   * Requête HTTP à partir de la configuration brute d'un équipement : résout les étiquettes
   * (url, en-têtes, corps, identifiants) et ajoute l'en-tête Authorization selon authType
   * (none | basic | bearer). Un en-tête Authorization saisi à la main est prioritaire.
   */
  public static function buildRequest($_conf) {
    $headers = array();
    foreach (self::parseHeaders($_conf['headers'] ?? '') as $k => $v) {
      $headers[$k] = trim(preg_replace('/[\r\n]+/', '', self::resolveTags($v)));
    }
    $hasAuth = false;
    foreach ($headers as $k => $v) {
      if (strcasecmp($k, 'Authorization') === 0) {
        $hasAuth = true;
      }
    }
    if (!$hasAuth) {
      switch ($_conf['authType'] ?? 'none') {
        case 'basic':
          $user = self::resolveTags($_conf['authUser'] ?? '');
          $pass = self::resolveTags($_conf['authPassword'] ?? '');
          if ($user !== '' || $pass !== '') {
            $headers['Authorization'] = 'Basic ' . base64_encode($user . ':' . $pass);
          }
          break;
        case 'bearer':
          $token = trim(self::resolveTags($_conf['authToken'] ?? ''));
          if ($token !== '') {
            $headers['Authorization'] = 'Bearer ' . $token;
          }
          break;
      }
    }
    return array(
      'url' => preg_replace('/\s+/', '', self::resolveTags(trim((string) ($_conf['url'] ?? '')))),
      'method' => strtoupper($_conf['method'] ?? 'GET') == 'POST' ? 'POST' : 'GET',
      'headers' => $headers,
      'body' => self::resolveTags((string) ($_conf['body'] ?? '')),
    );
  }

  /** Configuration que le daemon doit connaître (équipements actifs avec une URL). */
  public static function buildConfig() {
    $equipments = array();
    foreach (self::byType(__CLASS__, true) as $eq) {
      $commands = array();
      foreach ($eq->getCmd('info') as $cmd) {
        $path = trim((string) $cmd->getConfiguration('jsonPath', ''));
        if ($cmd->getLogicalId() != '' || $path === '') {
          continue; // commandes internes (statut...) ou sans chemin
        }
        $agg = (string) $cmd->getConfiguration('agg', 'first');
        $commands[] = array('id' => $cmd->getId(), 'path' => $path, 'agg' => in_array($agg, self::AGGREGATIONS, true) ? $agg : 'first');
      }
      $req = self::buildRequest($eq->getConfiguration());
      if ($req['url'] == '') {
        continue;
      }
      $equipments[] = array(
        'id' => $eq->getId(),
        'name' => $eq->getName(),
        'url' => $req['url'],
        'method' => $req['method'],
        'headers' => $req['headers'],
        'body' => $req['body'],
        'interval' => max(self::MIN_INTERVAL, (int) $eq->getConfiguration('interval', 30)),
        'timeout' => max(1, (int) $eq->getConfiguration('timeout', 10)),
        'verify_ssl' => (int) $eq->getConfiguration('verifySsl', 1) == 1,
        'commands' => $commands,
      );
    }
    return $equipments;
  }

  /* ------------------------------------------------------------------ */
  /* Surveillance du daemon (appelée chaque minute par le cron Jeedom)   */
  /* ------------------------------------------------------------------ */

  const WATCHDOG_MAX_LOOP_AGE = 30; // s : la boucle du daemon tourne au moins chaque seconde
  const WATCHDOG_FAILS_BEFORE_RESTART = 2;

  public static function cron() {
    try {
      self::watchdog();
    } catch (Exception $e) {
      log::add(__CLASS__, 'error', 'Surveillance du daemon : ' . $e->getMessage());
    }
  }

  /**
   * Un daemon dont le processus a disparu est déjà relancé par le core (gestion
   * automatique). Ici on couvre le reste : daemon vivant mais injoignable ou bloqué,
   * et daemon qui ne connaît pas (ou plus) les bons équipements.
   */
  public static function watchdog() {
    if (self::deamon_info()['state'] != 'ok') {
      return;
    }
    $problem = '';
    $status = array();
    try {
      $status = self::sendToDaemon(array('cmd' => 'status'));
      if (($status['loop_age'] ?? 0) > self::WATCHDOG_MAX_LOOP_AGE) {
        $problem = 'boucle de scrutation figée depuis ' . $status['loop_age'] . ' s';
      } elseif (!empty($status['stuck'])) {
        $problem = 'scrutation(s) bloquée(s) pour les équipements ' . implode(', ', $status['stuck']);
      }
    } catch (Exception $e) {
      $problem = 'daemon injoignable (' . $e->getMessage() . ')';
    }

    $key = 'jsonpoller::watchdog::fails';
    if ($problem !== '') {
      $fails = (int) cache::byKey($key)->getValue(0) + 1;
      cache::set($key, $fails);
      log::add(__CLASS__, 'warning', 'Daemon : ' . $problem . ' (' . $fails . '/' . self::WATCHDOG_FAILS_BEFORE_RESTART . ')');
      if ($fails >= self::WATCHDOG_FAILS_BEFORE_RESTART) {
        cache::set($key, 0);
        if (config::byKey('deamonAutoMode', __CLASS__, 1) != 1) {
          log::add(__CLASS__, 'error', 'Daemon en défaut mais gestion automatique désactivée : pas de redémarrage');
          return;
        }
        $msg = 'Daemon JSON Poller redémarré automatiquement : ' . $problem;
        log::add(__CLASS__, 'error', $msg);
        message::add(__CLASS__, $msg);
        self::deamon_start();
      }
      return;
    }
    cache::set($key, 0);

    // Daemon sain : vérifie qu'il connaît bien les équipements attendus
    $expected = array();
    foreach (self::buildConfig() as $eq) {
      $expected[] = (int) $eq['id'];
    }
    sort($expected);
    $known = array_map('intval', $status['equipments'] ?? array());
    sort($known);
    if ($expected !== $known) {
      log::add(__CLASS__, 'warning', 'Configuration du daemon désynchronisée (attendu : ' . implode(',', $expected) . ' / connu : ' . implode(',', $known) . ') : renvoi de la configuration');
      self::sendConfig();
    } elseif (self::configHash(self::buildConfig()) !== (string) cache::byKey('jsonpoller::config::hash')->getValue('')) {
      // une étiquette (#variable(..)#, #commande#) utilisée dans l'URL, les en-têtes ou les identifiants a changé
      log::add(__CLASS__, 'debug', 'Configuration modifiée (étiquettes Jeedom) : renvoi au daemon');
      self::sendConfig();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Callback du daemon                                                  */
  /* ------------------------------------------------------------------ */

  public static function handleCallback($_data) {
    $eq = self::byId($_data['eqId'] ?? 0);
    if (!is_object($eq) || $eq->getEqType_name() != __CLASS__) {
      return;
    }
    $http = (int) ($_data['http'] ?? 0);
    $error = (string) ($_data['error'] ?? '');
    if (!is_object($eq->getCmd(null, '_last_ok'))) {
      $eq->createInternalCmds(); // équipement créé avant l'ajout de cette commande
    }
    $eq->checkAndUpdateCmd('_http_status', $http);
    $eq->checkAndUpdateCmd('_error', $error);
    if ($error === '') {
      $eq->checkAndUpdateCmd('_last_ok', date('Y-m-d H:i:s'));
    } else {
      log::add(__CLASS__, 'debug', $eq->getHumanName() . ' : ' . $error . ' (nouvel essai dans ' . (int) ($_data['retry_in'] ?? 0) . ' s)');
    }
    foreach (($_data['errors'] ?? array()) as $cmdId => $msg) {
      log::add(__CLASS__, 'warning', $eq->getHumanName() . ' (commande ' . $cmdId . ') : ' . $msg);
    }
    foreach (($_data['values'] ?? array()) as $cmdId => $value) {
      $cmd = cmd::byId($cmdId);
      if (!is_object($cmd) || $cmd->getEqLogic_id() != $eq->getId()) {
        continue;
      }
      $converted = self::convertValue($value, $cmd->getSubType(), (string) $cmd->getConfiguration('format', 'auto'));
      if ($converted === null) {
        log::add(__CLASS__, 'warning', $eq->getHumanName() . ' / ' . $cmd->getName() . ' : valeur "' . json_encode($value) . '" incompatible avec le sous-type ' . $cmd->getSubType());
        continue;
      }
      if ($cmd->getSubType() == 'numeric') {
        $converted = self::applyScale($converted, $cmd->getConfiguration('factor', ''), $cmd->getConfiguration('offset', ''), $cmd->getConfiguration('decimals', ''));
      }
      $eq->checkAndUpdateCmd($cmd, $converted);
    }
  }

  /**
   * Convertit une valeur JSON pour Jeedom.
   * $_format : auto (selon le sous-type) | number | boolean | string
   *  - number  : "0.00", "1,5", " 21.5 °C" => nombre (nombre en tête de chaîne)
   *  - boolean : true/false, on/off, yes/no, open/closed, 0/1 => 0 ou 1
   *  - string  : texte (booléen => "true"/"false", objet/tableau => JSON)
   * Retourne null si la valeur est inconvertible (la commande n'est pas mise à jour).
   */
  public static function convertValue($_value, $_subType, $_format = 'auto') {
    if (is_array($_value)) {
      $_value = json_encode($_value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    switch ($_format) {
      case 'number':
        $_value = self::toNumber($_value);
        if ($_value === null) {
          return null;
        }
        break;
      case 'boolean':
        $_value = self::toBool($_value);
        if ($_value === null) {
          return null;
        }
        break;
      case 'string':
        if ($_value === null) {
          return '';
        }
        return is_bool($_value) ? ($_value ? 'true' : 'false') : (string) $_value;
    }
    if ($_value === null) {
      return $_subType == 'string' ? '' : null;
    }
    switch ($_subType) {
      case 'numeric':
        return self::toNumber($_value);
      case 'binary':
        return self::toBool($_value);
      default:
        return is_bool($_value) ? ($_value ? 'true' : 'false') : (string) $_value;
    }
  }

  /**
   * Met à l'échelle une valeur numérique : valeur * facteur + décalage, puis arrondi.
   * Champs vides ou non numériques = neutres (facteur 1, décalage 0). La virgule décimale est acceptée.
   * Sans nombre de décimales demandé, on arrondit à 10 décimales pour éliminer le bruit
   * des flottants (0.1 * 3 = 0.30000000000000004). Sans facteur ni décalage ni décimales : valeur inchangée.
   */
  public static function applyScale($_value, $_factor = '', $_offset = '', $_decimals = '') {
    if (!is_int($_value) && !is_float($_value)) {
      return $_value;
    }
    $num = function ($v, $default) {
      $v = str_replace(',', '.', trim((string) $v));
      return is_numeric($v) ? $v + 0 : $default;
    };
    $factor = $num($_factor, 1);
    $offset = $num($_offset, 0);
    $decimals = trim((string) $_decimals);
    if ($factor == 1 && $offset == 0 && !is_numeric($decimals)) {
      return $_value;
    }
    return round($_value * $factor + $offset, is_numeric($decimals) ? max(0, min(10, (int) $decimals)) : 10);
  }

  private static function toNumber($_value) {
    if (is_bool($_value)) {
      return $_value ? 1 : 0;
    }
    if (is_int($_value) || is_float($_value)) {
      return $_value;
    }
    if (is_string($_value) && preg_match('/^\s*([+-]?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)/u', $_value, $m)) {
      return str_replace(',', '.', $m[1]) + 0;
    }
    return null;
  }

  private static function toBool($_value) {
    if (is_string($_value)) {
      $v = strtolower(trim($_value));
      if (in_array($v, array('true', 'on', 'yes', 'open', '1'), true)) return 1;
      if (in_array($v, array('false', 'off', 'no', 'closed', '0', ''), true)) return 0;
      $n = self::toNumber($v);
      return $n === null ? null : ($n != 0 ? 1 : 0);
    }
    return $_value ? 1 : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  /** "Nom: valeur" (une par ligne) => tableau associatif. */
  public static function parseHeaders($_text) {
    $headers = array();
    foreach (preg_split('/\r\n|\r|\n/', (string) $_text) as $line) {
      if (strpos($line, ':') === false) {
        continue;
      }
      list($k, $v) = explode(':', $line, 2);
      if (trim($k) !== '') {
        $headers[trim($k)] = trim($v);
      }
    }
    return $headers;
  }

  /** Récupère une URL et retourne le JSON décodé (utilisé par le bouton de test de l'UI). */
  public static function fetchUrl($_url, $_method = 'GET', $_headers = array(), $_body = '', $_timeout = 10, $_verifySsl = true) {
    if (!preg_match('#^https?://#i', $_url)) {
      throw new Exception(__('L\'URL doit commencer par http:// ou https://', __FILE__));
    }
    $h = array('Accept: application/json');
    foreach ($_headers as $k => $v) {
      $h[] = $k . ': ' . $v;
    }
    $ch = curl_init($_url);
    curl_setopt_array($ch, array(
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_MAXREDIRS => 5,
      CURLOPT_TIMEOUT => max(1, (int) $_timeout),
      CURLOPT_HTTPHEADER => $h,
      CURLOPT_CUSTOMREQUEST => strtoupper($_method) == 'POST' ? 'POST' : 'GET',
      CURLOPT_SSL_VERIFYPEER => (bool) $_verifySsl,
      CURLOPT_SSL_VERIFYHOST => $_verifySsl ? 2 : 0,
    ));
    if (strtoupper($_method) == 'POST') {
      curl_setopt($ch, CURLOPT_POSTFIELDS, $_body);
    }
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
      throw new Exception($err);
    }
    if ($code >= 400) {
      throw new Exception('HTTP ' . $code);
    }
    $json = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
      throw new Exception(__('Réponse non JSON', __FILE__) . ' : ' . json_last_error_msg());
    }
    return $json;
  }

  /* ------------------------------------------------------------------ */
  /* Cycle de vie de l'équipement                                        */
  /* ------------------------------------------------------------------ */

  public function preSave() {
    $interval = (int) $this->getConfiguration('interval', 30);
    if ($interval < self::MIN_INTERVAL) {
      $this->setConfiguration('interval', self::MIN_INTERVAL);
    }
  }

  public function postSave() {
    $this->createInternalCmds();
  }

  /** Crée les commandes internes manquantes (idempotent). */
  public function createInternalCmds() {
    $defs = array(
      '_http_status' => array(__('Code HTTP', __FILE__), 'numeric'),
      '_error' => array(__('Erreur', __FILE__), 'string'),
      '_last_ok' => array(__('Dernière réponse OK', __FILE__), 'string'),
    );
    foreach ($defs as $logicalId => $def) {
      $cmd = $this->getCmd(null, $logicalId);
      if (!is_object($cmd)) {
        $cmd = new jsonpollerCmd();
        $cmd->setLogicalId($logicalId);
        $cmd->setEqLogic_id($this->getId());
        $cmd->setName($def[0]);
        $cmd->setType('info');
        $cmd->setSubType($def[1]);
        $cmd->setIsVisible(0);
        $cmd->save();
      }
    }
    $refresh = $this->getCmd(null, 'refresh');
    if (!is_object($refresh)) {
      $refresh = new jsonpollerCmd();
      $refresh->setLogicalId('refresh');
      $refresh->setEqLogic_id($this->getId());
      $refresh->setName(__('Rafraîchir', __FILE__));
      $refresh->setType('action');
      $refresh->setSubType('other');
      $refresh->save();
    }
  }

  /** Appelé après la sauvegarde des commandes depuis l'UI. */
  public function postAjax() {
    $this->pushConfig();
  }

  public function postRemove() {
    $this->pushConfig();
  }

  private function pushConfig() {
    if (self::deamon_info()['state'] != 'ok') {
      return;
    }
    try {
      self::sendConfig();
    } catch (Exception $e) {
      log::add(__CLASS__, 'error', 'Envoi de la configuration au daemon impossible : ' . $e->getMessage());
    }
  }
}

class jsonpollerCmd extends cmd {

  public function execute($_options = array()) {
    if ($this->getType() == 'action' && $this->getLogicalId() == 'refresh') {
      jsonpoller::sendToDaemon(array('cmd' => 'refresh', 'id' => $this->getEqLogic_id()));
    }
  }
}
