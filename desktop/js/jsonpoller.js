/* global jeedom, bootbox, domUtils, jeedomUtils, init, isset, addCmdToTable, $ */

/* ---------- Table des commandes ---------- */
function addCmdToTable(_cmd) {
  if (!isset(_cmd)) {
    var _cmd = { configuration: {} }
  }
  if (!isset(_cmd.configuration)) {
    _cmd.configuration = {}
  }
  var isAction = init(_cmd.type) == 'action'
  var tr = '<tr class="cmd" data-cmd_id="' + init(_cmd.id) + '">'
  tr += '<td class="hidden-xs"><span class="cmdAttr" data-l1key="id"></span></td>'
  tr += '<td><input class="cmdAttr form-control input-sm" data-l1key="name" placeholder="{{Nom de la commande}}"></td>'
  tr += '<td>'
  tr += '<span class="type" type="' + init(_cmd.type) + '">' + jeedom.cmd.availableType() + '</span>'
  tr += '<span class="subType" subType="' + init(_cmd.subType) + '"></span>'
  tr += '</td>'
  tr += '<td>'
  if (!isAction && init(_cmd.logicalId) == '') {
    tr += '<input class="cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="jsonPath" placeholder="ex : data.temperature  ou  items[0].value">'
    tr += '<select class="cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="agg" style="margin-top:5px;" title="{{Si le chemin contient un joker [*] ou un filtre [?(...)] et désigne plusieurs valeurs}}">'
    tr += '<option value="first">{{Plusieurs valeurs : la première}}</option>'
    tr += '<option value="last">{{Plusieurs valeurs : la dernière}}</option>'
    tr += '<option value="sum">{{Plusieurs valeurs : somme}}</option>'
    tr += '<option value="avg">{{Plusieurs valeurs : moyenne}}</option>'
    tr += '<option value="min">{{Plusieurs valeurs : minimum}}</option>'
    tr += '<option value="max">{{Plusieurs valeurs : maximum}}</option>'
    tr += '<option value="count">{{Plusieurs valeurs : nombre}}</option>'
    tr += '<option value="list">{{Plusieurs valeurs : liste JSON}}</option>'
    tr += '</select>'
    tr += '<select class="cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="format" style="margin-top:5px;" title="{{Conversion de la valeur JSON avant écriture dans la commande}}">'
    tr += '<option value="auto">{{Format : automatique (selon le sous-type)}}</option>'
    tr += '<option value="number">{{Format : nombre (&quot;0.00&quot; ou &quot;1,5&quot; → nombre)}}</option>'
    tr += '<option value="boolean">{{Format : booléen (true/on/1 → 1)}}</option>'
    tr += '<option value="string">{{Format : texte}}</option>'
    tr += '</select>'
    tr += '<div style="margin-top:5px;">'
    tr += '<input class="tooltips cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="factor" placeholder="{{× facteur}}" title="{{Facteur multiplicateur appliqué aux valeurs numériques (ex : 0.001 pour convertir des mW en W). Valeur finale = valeur × facteur + décalage}}" style="width:32%;max-width:90px;display:inline-block;margin-right:2px;">'
    tr += '<input class="tooltips cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="offset" placeholder="{{+ décalage}}" title="{{Valeur ajoutée après multiplication (ex : -273.15 pour passer de Kelvin en °C)}}" style="width:32%;max-width:90px;display:inline-block;margin-right:2px;">'
    tr += '<input class="tooltips cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="decimals" placeholder="{{Décim.}}" title="{{Nombre de décimales conservées (0 à 10). Vide = pas d\'arrondi particulier}}" style="width:28%;max-width:80px;display:inline-block;">'
    tr += '</div>'
  } else if (!isAction) {
    tr += '<span class="label label-default">{{Commande interne}}</span>'
  }
  tr += '</td>'
  tr += '<td>'
  tr += '<label class="checkbox-inline"><input type="checkbox" class="cmdAttr" data-l1key="isVisible" checked/>{{Afficher}}</label> '
  if (!isAction) {
    tr += '<label class="checkbox-inline"><input type="checkbox" class="cmdAttr" data-l1key="isHistorized"/>{{Historiser}}</label> '
    tr += '<div style="margin-top:7px;">'
    tr += '<input class="tooltips cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="minValue" placeholder="{{Min}}" title="{{Min}}" style="width:30%;max-width:80px;display:inline-block;margin-right:2px;">'
    tr += '<input class="tooltips cmdAttr form-control input-sm" data-l1key="configuration" data-l2key="maxValue" placeholder="{{Max}}" title="{{Max}}" style="width:30%;max-width:80px;display:inline-block;margin-right:2px;">'
    tr += '<input class="tooltips cmdAttr form-control input-sm" data-l1key="unite" placeholder="{{Unité}}" title="{{Unité}}" style="width:30%;max-width:80px;display:inline-block;margin-right:2px;">'
    tr += '</div>'
  }
  tr += '</td>'
  tr += '<td>'
  if (is_numeric(_cmd.id)) {
    tr += '<a class="btn btn-default btn-xs cmdAction" data-action="configure"><i class="fas fa-cogs"></i></a> '
    tr += '<a class="btn btn-default btn-xs cmdAction" data-action="test"><i class="fas fa-rss"></i> {{Tester}}</a> '
  }
  if (init(_cmd.logicalId) == '') {
    tr += '<i class="fas fa-minus-circle pull-right cmdAction cursor" data-action="remove" title="{{Supprimer la commande}}"></i>'
  }
  tr += '</td>'
  tr += '</tr>'
  $('#table_cmd tbody').append(tr)
  var $tr = $('#table_cmd tbody tr').last()
  $tr.setValues(_cmd, '.cmdAttr')
  jeedom.cmd.changeType($tr, init(_cmd.subType))
}

/* ---------- Authentification : champs affichés selon le type ---------- */
function toggleAuthFields() {
  var type = $('.eqLogicAttr[data-l1key=configuration][data-l2key=authType]').value()
  $('.authBasic').toggle(type === 'basic')
  $('.authBearer').toggle(type === 'bearer')
}
$('.eqLogicAttr[data-l1key=configuration][data-l2key=authType]').off('change').on('change', toggleAuthFields)
function printEqLogic(_eqLogic) {
  toggleAuthFields()
}

/* ---------- Explorateur JSON ---------- */
/* Sous-type et format proposés pour une valeur : les nombres écrits entre guillemets ("0.00") deviennent numériques. */
function jsonSubType(value) {
  var numStr = typeof value === 'string' && /^\s*[+-]?\d+([.,]\d+)?\s*$/.test(value)
  if (typeof value === 'number' || numStr) return { subType: 'numeric', format: numStr ? 'number' : 'auto' }
  if (typeof value === 'boolean') return { subType: 'binary', format: 'auto' }
  return { subType: 'string', format: 'auto' }
}

/* Nom de commande proposé pour un chemin : items[0].temp -> temp, a["x"] -> x, list[2] -> list_2 */
function jsonCmdName(path) {
  var m = path.match(/(?:\["([^"]*)"\]|\['([^']*)'\]|([^.\[\]]+))((?:\[-?\d+\])*)$/)
  if (!m) return 'valeur'
  var base = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])
  return (base + (m[4] || '').replace(/\[(-?\d+)\]/g, '_$1')) || 'valeur'
}

/* Chemin de l'enfant `key` de `parent`, dans la syntaxe comprise par le daemon. Retourne null si la clé est inexprimable
   (elle contient à la fois " et '). */
function jsonPathKey(parent, key) {
  if (typeof key === 'number') return parent + '[' + key + ']'
  var plain = /^[^.\[\]"']+$/.test(key) && key === key.trim() && key !== '*' && !(parent === '' && key.charAt(0) === '$')
  if (plain) return parent === '' ? key : parent + '.' + key
  if (key.indexOf('"') === -1) return parent + '["' + key + '"]'
  if (key.indexOf("'") === -1) return parent + "['" + key + "']"
  return null
}

function flattenJson(node, path, out, limit) {
  if (out.length >= limit) return
  if (node !== null && typeof node === 'object') {
    var keys = Array.isArray(node) ? node.slice(0, 50).map(function (_, i) { return i }) : Object.keys(node)
    keys.forEach(function (k) {
      var childPath = jsonPathKey(path, k)
      if (childPath !== null) flattenJson(node[k], childPath, out, limit)
    })
  } else {
    out.push({ path: path, value: node })
  }
}

$('#bt_exploreJson').off('click').on('click', function () {
  var attr = function (k) { return $('.eqLogicAttr[data-l1key=configuration][data-l2key=' + k + ']') }
  var url = attr('url').value()
  if (!url) {
    jeedomUtils.showAlert({ message: '{{Renseignez d\'abord l\'URL}}', level: 'warning' })
    return
  }
  $.ajax({
    type: 'POST',
    url: 'plugins/jsonpoller/core/ajax/jsonpoller.ajax.php',
    data: {
      action: 'testUrl',
      url: url,
      method: attr('method').value(),
      headers: attr('headers').value(),
      body: attr('body').value(),
      authType: attr('authType').value(),
      authUser: attr('authUser').value(),
      authPassword: attr('authPassword').value(),
      authToken: attr('authToken').value(),
      timeout: attr('timeout').value() || 10,
      verifySsl: attr('verifySsl').is(':checked') ? 1 : 0
    },
    dataType: 'json',
    global: false,
    error: function (request, status, error) {
      jeedomUtils.showAlert({ message: error, level: 'danger' })
    },
    success: function (data) {
      if (data.state != 'ok') {
        jeedomUtils.showAlert({ message: data.result, level: 'danger' })
        return
      }
      var rows = []
      flattenJson(data.result, '', rows, 1000)
      var html = '<input class="form-control" id="in_jsonFilter" placeholder="{{Filtrer par chemin ou valeur}}" style="margin-bottom:8px;">'
      html += '<div style="max-height:420px;overflow:auto;"><table class="table table-condensed table-hover" id="table_jsonValues"><thead><tr><th>{{Chemin}}</th><th>{{Valeur}}</th></tr></thead><tbody>'
      rows.forEach(function (r) {
        var v = r.value === null ? 'null' : String(r.value)
        var guess = jsonSubType(r.value)
        html += '<tr class="cursor jsonRow" data-path="' + $('<i>').text(r.path).html().replace(/"/g, '&quot;') + '" data-subtype="' + guess.subType + '" data-format="' + guess.format + '">'
        html += '<td><code>' + $('<i>').text(r.path === '' ? '(racine)' : r.path).html() + '</code></td>'
        html += '<td>' + $('<i>').text(v.length > 120 ? v.substr(0, 120) + '…' : v).html() + '</td></tr>'
      })
      html += '</tbody></table></div>'
      html += '<p class="help-block">{{Cliquez sur une ligne pour créer la commande info correspondante.}}</p>'
      var dlg = bootbox.dialog({
        title: '{{Valeurs disponibles dans le JSON}}',
        message: html,
        size: 'large',
        buttons: { close: { label: '{{Fermer}}', className: 'btn-default' } }
      })
      dlg.on('input', '#in_jsonFilter', function () {
        var q = $(this).val().toLowerCase()
        dlg.find('tr.jsonRow').each(function () {
          $(this).toggle($(this).text().toLowerCase().indexOf(q) !== -1)
        })
      })
      dlg.on('click', 'tr.jsonRow', function () {
        var path = $(this).attr('data-path')
        addCmdToTable({
          type: 'info', subType: $(this).attr('data-subtype'), name: jsonCmdName(path), isVisible: 1,
          configuration: { jsonPath: path, format: $(this).attr('data-format') }
        })
        $('.cmd:last .cmdAttr[data-l1key=type]').val('info')
        modifyWithoutSave = true
        $(this).addClass('success')
      })
    }
  })
})
