<?php
require_once __DIR__ . '/../../../../core/php/core.inc.php';

class jsonpoller extends eqLogic {

  const MIN_INTERVAL = 10;

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
    $cmd .= ' --apikey ' . escapeshellarg(jeedom::getApiKey(__CLASS__));
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
    fclose($fp);
    $reply = json_decode((string) $reply, true);
    if (!is_array($reply) || empty($reply['ok'])) {
      throw new Exception('Réponse du daemon invalide : ' . json_encode($reply));
    }
    return $reply;
  }

  /** Pousse la configuration de tous les équipements actifs au daemon. */
  public static function sendConfig() {
    $equipments = array();
    foreach (self::byType(__CLASS__, true) as $eq) {
      $commands = array();
      foreach ($eq->getCmd('info') as $cmd) {
        $path = trim((string) $cmd->getConfiguration('jsonPath', ''));
        if ($cmd->getLogicalId() != '' || $path === '') {
          continue; // commandes internes (statut...) ou sans chemin
        }
        $commands[] = array('id' => $cmd->getId(), 'path' => $path);
      }
      $url = trim((string) $eq->getConfiguration('url'));
      if ($url == '') {
        continue;
      }
      $equipments[] = array(
        'id' => $eq->getId(),
        'name' => $eq->getName(),
        'url' => $url,
        'method' => strtoupper($eq->getConfiguration('method', 'GET')),
        'headers' => self::parseHeaders($eq->getConfiguration('headers', '')),
        'body' => (string) $eq->getConfiguration('body', ''),
        'interval' => max(self::MIN_INTERVAL, (int) $eq->getConfiguration('interval', 30)),
        'timeout' => max(1, (int) $eq->getConfiguration('timeout', 10)),
        'verify_ssl' => (int) $eq->getConfiguration('verifySsl', 1) == 1,
        'commands' => $commands,
      );
    }
    return self::sendToDaemon(array('cmd' => 'config', 'equipments' => $equipments));
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
    $eq->checkAndUpdateCmd('_http_status', $http);
    $eq->checkAndUpdateCmd('_error', $error);
    if ($error !== '') {
      log::add(__CLASS__, 'debug', $eq->getHumanName() . ' : ' . $error);
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
    $defs = array(
      '_http_status' => array('Code HTTP', 'numeric'),
      '_error' => array('Erreur', 'string'),
    );
    foreach ($defs as $logicalId => $def) {
      $cmd = $this->getCmd(null, $logicalId);
      if (!is_object($cmd)) {
        $cmd = new jsonpollerCmd();
        $cmd->setLogicalId($logicalId);
        $cmd->setEqLogic_id($this->getId());
        $cmd->setName(__($def[0], __FILE__));
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
