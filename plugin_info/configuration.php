<?php
require_once __DIR__ . '/../../../core/php/core.inc.php';
include_file('core', 'authentification', 'php');
if (!isConnect()) {
  include_file('desktop', '404', 'php');
  die();
}
?>
<form class="form-horizontal">
  <fieldset>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Port du daemon (local uniquement)}}
        <sup><i class="fas fa-question-circle tooltips" title="{{Port TCP sur 127.0.0.1 utilisé par Jeedom pour communiquer avec le daemon. Changer uniquement en cas de conflit.}}"></i></sup>
      </label>
      <div class="col-md-2">
        <input class="configKey form-control" data-l1key="socketport" placeholder="55081"/>
      </div>
    </div>
  </fieldset>
</form>
