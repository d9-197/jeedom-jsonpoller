<?php
require_once __DIR__ . '/../../../core/php/core.inc.php';

function jsonpoller_install() {
  if (config::byKey('socketport', 'jsonpoller', '') === '') {
    config::save('socketport', 55081, 'jsonpoller');
  }
}

function jsonpoller_update() {
  jsonpoller_install();
}

function jsonpoller_remove() {
}
