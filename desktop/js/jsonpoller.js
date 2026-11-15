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
    tr += jsonAggOptions()
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
var JSON_ID_FIELDS = ['id', 'name', 'key', 'uuid', 'mac', 'ip', 'serial', 'label', 'title', 'nom']
var JSON_CHUNK = 50
var JSON_NUMERIC_AGGS = ['sum', 'avg', 'min', 'max', 'count']

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

/* Échappement HTML : les valeurs viennent d'une source distante, elles ne doivent jamais être injectées telles quelles. */
function jsonEsc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function jsonKind(v) {
  if (v !== null && typeof v === 'object') return Array.isArray(v) ? 'arr' : 'obj'
  return 'leaf'
}

/* Texte affiché pour une valeur (les textes gardent leurs guillemets : "0.00" n'est pas 0.00). */
function jsonShow(v, max) {
  var t = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v === undefined ? null : v)
  max = max || 120
  return t.length > max ? t.substr(0, max) + '…' : t
}

/* Littéral utilisable dans un filtre ([?(@.id==3)]), ou null si la valeur n'est pas utilisable comme identifiant. */
function jsonIdLiteral(v) {
  if (typeof v === 'number' && isFinite(v)) return String(v)
  if (typeof v === 'string' && v.indexOf(')]') === -1) return JSON.stringify(v)
  return null
}

/* Champ qui identifie chaque élément d'un tableau d'objets (présent partout, scalaire, unique) : id, name, ... */
function jsonIdField(arr) {
  for (var f = 0; f < JSON_ID_FIELDS.length; f++) {
    var field = JSON_ID_FIELDS[f]
    var seen = {}
    var ok = arr.length > 0
    for (var i = 0; i < arr.length && ok; i++) {
      var item = arr[i]
      var lit = item !== null && typeof item === 'object' && !Array.isArray(item) ? jsonIdLiteral(item[field]) : null
      if (lit === null || seen[lit]) ok = false
      else seen[lit] = true
    }
    if (ok) return field
  }
  return null
}

/* base + suite relative : jsonJoin('a[*]', 'v') = 'a[*].v' ; jsonJoin('a[*]', '["x"]') = 'a[*]["x"]' */
function jsonJoin(base, rel) {
  return rel === '' ? base : (rel.charAt(0) === '[' ? base + rel : base + '.' + rel)
}

/* Autres façons de désigner une valeur située dans un élément de tableau (plus stables que l'index) :
   filtre par identifiant, ou tous les éléments avec agrégation. */
function jsonAlternatives(ctx, value) {
  var alts = []
  if (ctx.sel) alts.push({ id: 'filter', path: jsonJoin(ctx.arrayPath + '[' + ctx.sel + ']', ctx.rel), agg: 'first' })
  var wild = jsonJoin(ctx.arrayPath + '[*]', ctx.rel)
  var numeric = jsonSubType(value).subType === 'numeric'
  var ids = numeric ? ['sum', 'avg', 'min', 'max', 'count', 'list'] : ['first', 'last', 'count', 'list']
  ids.forEach(function (id) { alts.push({ id: id, path: wild, agg: id }) })
  return alts
}

/* Enfants [start, start+count) d'un objet ou tableau. `ctx` décrit l'élément de tableau englobant le plus proche
   (null hors tableau). Retourne { items: [descripteurs], total }. */
function jsonChildren(node, path, ctx, start, count) {
  var isArr = Array.isArray(node)
  var keys = isArr ? node.map(function (_, i) { return i }) : Object.keys(node)
  var idField = isArr ? jsonIdField(node) : null
  var items = []
  var end = Math.min(keys.length, start + count)
  for (var n = start; n < end; n++) {
    var k = keys[n]
    var v = node[k]
    var childPath = jsonPathKey(path, k)
    if (childPath === null) continue
    var childCtx = null
    if (isArr) {
      var lit = idField ? jsonIdLiteral(v[idField]) : null
      childCtx = { arrayPath: path, index: k, rel: '', sel: lit !== null ? '?(@.' + idField + '==' + lit + ')' : null }
    } else if (ctx) {
      var rel = jsonPathKey(ctx.rel, k)
      childCtx = rel === null ? null : { arrayPath: ctx.arrayPath, index: ctx.index, rel: rel, sel: ctx.sel }
    }
    var kind = jsonKind(v)
    var d = { key: k, path: childPath, kind: kind, value: v, ctx: childCtx }
    if (kind !== 'leaf') d.size = Array.isArray(v) ? v.length : Object.keys(v).length
    if (kind === 'leaf' && childCtx) d.alts = jsonAlternatives(childCtx, v)
    items.push(d)
  }
  return { items: items, total: keys.length }
}

/* Toutes les feuilles correspondant aux filtres (mode « liste » quand on filtre). opts : { limit, text, type }
   type : all | numeric | boolean | string | null. Retourne { leaves, truncated }. */
function jsonLeaves(data, opts) {
  var limit = opts.limit || 500
  var text = (opts.text || '').toLowerCase()
  var type = opts.type || 'all'
  var out = []
  var truncated = false
  function matches(d) {
    var t = d.value === null ? 'null' : jsonSubType(d.value).subType
    if (type === 'boolean' && t !== 'binary') return false
    if (type === 'numeric' && t !== 'numeric') return false
    if (type === 'string' && !(t === 'string' && d.value !== null)) return false
    if (type === 'null' && d.value !== null) return false
    return text === '' || (d.path + ' ' + String(d.value)).toLowerCase().indexOf(text) !== -1
  }
  function walk(node, path, ctx) {
    for (var start = 0; !truncated; start += 500) {
      var r = jsonChildren(node, path, ctx, start, 500)
      for (var i = 0; i < r.items.length && !truncated; i++) {
        var d = r.items[i]
        if (d.kind !== 'leaf') walk(d.value, d.path, d.ctx)
        else if (matches(d)) {
          if (out.length >= limit) truncated = true
          else out.push(d)
        }
      }
      if (start + 500 >= r.total) break
    }
  }
  if (jsonKind(data) === 'leaf') {
    var root = { key: '', path: '', kind: 'leaf', value: data, ctx: null }
    if (matches(root)) out.push(root)
  } else {
    walk(data, '', null)
  }
  return { leaves: out, truncated: truncated }
}

/* Commande info à créer pour (chemin, agrégation) ; `value` = valeur d'exemple (ou résultat du test). */
function jsonCmdFor(path, agg, value) {
  var sub
  if (JSON_NUMERIC_AGGS.indexOf(agg) !== -1) sub = { subType: 'numeric', format: 'auto' }
  else if (agg === 'list') sub = { subType: 'string', format: 'auto' }
  else sub = jsonSubType(value)
  var suffix = agg && agg !== 'first' ? '_' + agg : ''
  return {
    type: 'info', subType: sub.subType, name: jsonCmdName(path) + suffix, isVisible: 1,
    configuration: { jsonPath: path, format: sub.format, agg: agg || 'first' }
  }
}

/* Le couple (chemin, agrégation) est-il déjà utilisé par une commande ? existing : [{path, agg}] */
function jsonIsUsed(existing, path, agg) {
  return existing.some(function (e) { return e.path === path && (e.agg || 'first') === (agg || 'first') })
}

/* Options du menu « Plusieurs valeurs » (partagées par le tableau des commandes et le testeur) */
function jsonAggOptions() {
  return '<option value="first">{{Plusieurs valeurs : la première}}</option>' +
    '<option value="last">{{Plusieurs valeurs : la dernière}}</option>' +
    '<option value="sum">{{Plusieurs valeurs : somme}}</option>' +
    '<option value="avg">{{Plusieurs valeurs : moyenne}}</option>' +
    '<option value="min">{{Plusieurs valeurs : minimum}}</option>' +
    '<option value="max">{{Plusieurs valeurs : maximum}}</option>' +
    '<option value="count">{{Plusieurs valeurs : nombre}}</option>' +
    '<option value="list">{{Plusieurs valeurs : liste JSON}}</option>'
}

/* ---- rendu HTML (chaînes pures, testables) ---- */
function jsonAltLabel(alt, d) {
  switch (alt.id) {
    case 'exact': return '{{Cet élément}} [' + d.ctx.index + ']'
    case 'filter': return '{{Filtre}} ' + d.ctx.sel.slice(2, -1)   // ?(@.id==3) -> @.id==3
    case 'first': return '{{[*] première valeur}}'
    case 'last': return '{{[*] dernière valeur}}'
    case 'sum': return '{{[*] somme}}'
    case 'avg': return '{{[*] moyenne}}'
    case 'min': return '{{[*] minimum}}'
    case 'max': return '{{[*] maximum}}'
    case 'count': return '{{[*] nombre}}'
    default: return '{{[*] liste JSON}}'
  }
}

/* opts : { rid, flat, used, checked } */
function jsonRowHtml(d, opts) {
  // couleur selon le type JSON réel : "1.5" (texte) n'est pas coloré comme 1.5 (nombre)
  var t = d.value === null ? 'null' : (typeof d.value === 'number' ? 'numeric' : (typeof d.value === 'boolean' ? 'binary' : 'string'))
  var h = '<div class="jp-row jp-leaf' + (opts.used ? ' jp-used' : '') + '" data-rid="' + opts.rid + '">'
  h += '<input type="checkbox" class="jp-sel"' + (opts.checked ? ' checked' : '') + (opts.used ? ' disabled' : '') + '> '
  h += opts.flat ? '' : '<span class="jp-key">' + jsonEsc(d.key) + '</span> '
  h += '<span class="jp-val jp-t-' + t + '" title="' + jsonEsc(jsonShow(d.value, 2000)) + '">' + jsonEsc(jsonShow(d.value)) + '</span>'
  if (d.alts && d.alts.length) {
    h += '<select class="jp-alt input-sm" title="{{Comment désigner cette valeur dans le tableau}}">'
    h += '<option value="exact" data-path="' + jsonEsc(d.path) + '" data-agg="first">' + jsonEsc(jsonAltLabel({ id: 'exact' }, d)) + '</option>'
    d.alts.forEach(function (a) {
      h += '<option value="' + a.id + '" data-path="' + jsonEsc(a.path) + '" data-agg="' + a.agg + '">' + jsonEsc(jsonAltLabel(a, d)) + '</option>'
    })
    h += '</select>'
  }
  h += '<code class="jp-path">' + jsonEsc(d.path === '' ? '(racine)' : d.path) + '</code>'
  h += '<span class="jp-actions"><a class="jp-test" title="{{Tester / modifier ce chemin}}"><i class="fas fa-flask"></i></a> '
  h += '<a class="jp-copy" title="{{Copier le chemin}}"><i class="fas fa-copy"></i></a></span>'
  return h + '</div>'
}

function jsonContainerHtml(d, rid) {
  var count = d.kind === 'arr' ? '[' + d.size + ']' : '{' + d.size + '}'
  return '<div class="jp-node" data-rid="' + rid + '"><div class="jp-row jp-container">' +
    '<a class="jp-toggle"><i class="fas fa-caret-right"></i></a> <span class="jp-key">' + jsonEsc(d.key) + '</span> ' +
    '<span class="text-muted">' + count + '</span></div><div class="jp-children" style="display:none"></div></div>'
}

function jsonMoreHtml(rid, remaining) {
  return '<div class="jp-more" data-rid="' + rid + '"><a class="jp-more-next">{{Afficher la suite}}</a> (' + remaining +
    ' {{non affichés}}) · <a class="jp-more-all">{{tout afficher}}</a></div>'
}

/* Résultat du testeur de chemin */
function jsonEvalHtml(res) {
  if (!res.valid) return '<span class="text-danger"><i class="fas fa-times-circle"></i> ' + jsonEsc(res.error) + '</span>'
  var h = '<span class="text-success"><i class="fas fa-check-circle"></i></span> <code>' + jsonEsc(jsonShow(res.value, 300)) + '</code>'
  if (res.multi) h += ' <span class="text-muted">(' + res.matches + ' {{valeur(s) sélectionnée(s)}})</span>'
  return h
}

/* ---- interaction ---- */
function jsonpollerAjax(action, data, success, error) {
  $.ajax({
    type: 'POST',
    url: 'plugins/jsonpoller/core/ajax/jsonpoller.ajax.php',
    data: $.extend({ action: action }, data),
    dataType: 'json',
    global: false,
    error: function (request, status, err) { error(err || status) },
    success: function (res) {
      if (res.state != 'ok') { error(res.result); return }
      success(res.result)
    }
  })
}

/* Copie dans le presse-papiers : API moderne si la page est sécurisée (https), sinon ou en cas de refus,
   repli via un champ temporaire (Jeedom est souvent servi en http sur le réseau local).
   `container` : élément où placer ce champ. Dans une fenêtre Bootstrap, il doit être DANS la fenêtre : sinon
   la fenêtre reprend le focus et la copie ne copie rien. */
function jsonCopyFallback(text, container) {
  var ta = $('<textarea>').val(text).css({ position: 'fixed', top: 0, left: 0, opacity: 0 }).appendTo(container || 'body')
  ta[0].focus()
  ta[0].select()
  try { document.execCommand('copy') } catch (e) { /* navigateur sans copie possible */ }
  ta.remove()
}

function jsonCopy(text, container) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(function () { jsonCopyFallback(text, container) })
    return
  }
  jsonCopyFallback(text, container)
}

/* Lit le formulaire (même non sauvegardé) et récupère le JSON de la source. */
function jsonFetch(onData) {
  var attr = function (k) { return $('.eqLogicAttr[data-l1key=configuration][data-l2key=' + k + ']') }
  var url = attr('url').value()
  if (!url) {
    jeedomUtils.showAlert({ message: '{{Renseignez d\'abord l\'URL}}', level: 'warning' })
    return
  }
  jsonpollerAjax('testUrl', {
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
  }, onData, function (msg) {
    jeedomUtils.showAlert({ message: msg, level: 'danger' })
  })
}

function jsonExistingCmds() {
  var out = []
  $('#table_cmd tbody tr.cmd').each(function () {
    var $tr = $(this)
    var path = $tr.find('.cmdAttr[data-l2key=jsonPath]').val()
    if (path !== undefined) out.push({ path: path, agg: $tr.find('.cmdAttr[data-l2key=agg]').val() || 'first' })
  })
  return out
}

function jsonOpenExplorer(data) {
  var state = { data: data, raw: JSON.stringify(data), rows: {}, nextId: 1, selected: {}, existing: [], filterTimer: null, testTimer: null, last: null }
  var key = function (path, agg) { return path + '\u0001' + agg }

  var html = '<div class="jp-explorer">'
  html += '<div class="form-inline jp-toolbar">'
  html += '<input id="jp-filter" class="form-control input-sm" placeholder="{{Filtrer par chemin ou valeur}}"> '
  html += '<select id="jp-type" class="form-control input-sm"><option value="all">{{Tous les types}}</option>' +
    '<option value="numeric">{{Nombres}}</option><option value="boolean">{{Booléens}}</option>' +
    '<option value="string">{{Textes}}</option><option value="null">{{Valeurs nulles}}</option></select> '
  html += '<a id="jp-reload" class="btn btn-default btn-sm"><i class="fas fa-sync"></i> {{Recharger}}</a>'
  html += '</div>'
  html += '<div class="jp-tester well well-sm"><label>{{Tester un chemin}}</label>'
  html += '<div class="input-group"><input id="jp-test-path" class="form-control input-sm" placeholder="items[?(@.id==3)].value">' +
    '<span class="input-group-addon"><select id="jp-test-agg">' + jsonAggOptions() + '</select></span>' +
    '<span class="input-group-btn"><a id="jp-test-create" class="btn btn-default btn-sm disabled"><i class="fas fa-plus-circle"></i> {{Créer la commande}}</a></span></div>'
  html += '<div id="jp-test-result" class="jp-test-result"></div></div>'
  html += '<div id="jp-body" class="jp-body"></div>'
  html += '<p class="help-block">{{Cochez des valeurs puis cliquez sur « Créer ». Dans un tableau, le menu permet de désigner la valeur par son identifiant (plus stable que l\'index) ou de calculer sur tous les éléments.}}</p>'
  html += '</div>'

  var dlg = bootbox.dialog({
    title: '{{Valeurs disponibles dans le JSON}}',
    message: html,
    size: 'large',
    buttons: {
      create: { label: '{{Créer}}', className: 'btn-success', callback: function () { createSelected(); return false } },
      close: { label: '{{Fermer}}', className: 'btn-default' }
    }
  })
  var $body = dlg.find('#jp-body')

  function register(d) {
    var rid = state.nextId++
    state.rows[rid] = { d: d, cur: { path: d.path, agg: 'first' } }
    return rid
  }

  function leafHtml(d, flat) {
    var rid = register(d)
    var cur = state.rows[rid].cur
    return jsonRowHtml(d, { rid: rid, flat: flat, used: jsonIsUsed(state.existing, cur.path, cur.agg), checked: !!state.selected[key(cur.path, cur.agg)] })
  }

  function renderChildren(node, path, ctx, $into, start, depth, all) {
    var r = jsonChildren(node, path, ctx, start, all ? Infinity : JSON_CHUNK)
    r.items.forEach(function (d) {
      if (d.kind === 'leaf') {
        $into.append(leafHtml(d, false))
      } else {
        var rid = register(d)
        $into.append(jsonContainerHtml(d, rid))
        if (depth < 1) expand($into.children('.jp-node').last())
      }
    })
    var shown = start + r.items.length
    if (shown < r.total) {
      var mid = state.nextId++
      state.rows[mid] = { more: { node: node, path: path, ctx: ctx, next: shown, depth: depth } }
      $into.append(jsonMoreHtml(mid, r.total - shown))
    }
  }

  function expand($node) {
    var row = state.rows[$node.attr('data-rid')]
    var $children = $node.children('.jp-children')
    if (!row.rendered) {
      row.rendered = true
      renderChildren(row.d.value, row.d.path, row.d.ctx, $children, 0, 1, false)
    }
    $children.show()
    $node.find('> .jp-container .fa-caret-right').removeClass('fa-caret-right').addClass('fa-caret-down')
  }

  function updateFooter() {
    var n = Object.keys(state.selected).length
    dlg.find('.modal-footer .btn-success').text('{{Créer}} (' + n + ')').prop('disabled', n === 0)
  }

  function render() {
    state.rows = {}
    state.nextId = 1
    state.existing = jsonExistingCmds()
    var text = dlg.find('#jp-filter').val()
    var type = dlg.find('#jp-type').val()
    $body.empty()
    if (text !== '' || type !== 'all') {
      var res = jsonLeaves(state.data, { limit: 500, text: text, type: type })
      res.leaves.forEach(function (d) { $body.append(leafHtml(d, true)) })
      if (res.leaves.length === 0) $body.append('<p class="text-muted">{{Aucune valeur ne correspond.}}</p>')
      if (res.truncated) $body.append('<p class="text-warning">{{Résultats limités aux 500 premières valeurs : affinez le filtre.}}</p>')
    } else if (jsonKind(state.data) === 'leaf') {
      $body.append(leafHtml({ key: '', path: '', kind: 'leaf', value: state.data, ctx: null }, false))
    } else {
      renderChildren(state.data, '', null, $body, 0, 0, false)
    }
    updateFooter()
  }

  function refreshMarks() {
    state.existing = jsonExistingCmds()
    $body.find('.jp-leaf').each(function () {
      var $row = $(this)
      var cur = state.rows[$row.attr('data-rid')].cur
      var used = jsonIsUsed(state.existing, cur.path, cur.agg)
      $row.toggleClass('jp-used', used)
      $row.find('.jp-sel').prop('disabled', used).prop('checked', !used && !!state.selected[key(cur.path, cur.agg)])
    })
    updateFooter()
  }

  function createSelected() {
    Object.keys(state.selected).forEach(function (k) {
      var s = state.selected[k]
      addCmdToTable(jsonCmdFor(s.path, s.agg, s.value))
    })
    if (Object.keys(state.selected).length) modifyWithoutSave = true
    state.selected = {}
    refreshMarks()
  }

  /* testeur de chemin : évalué par le daemon (même logique que la scrutation) */
  function runTest() {
    var path = dlg.find('#jp-test-path').val()
    var agg = dlg.find('#jp-test-agg').val()
    var $res = dlg.find('#jp-test-result')
    var $create = dlg.find('#jp-test-create')
    jsonpollerAjax('evalPath', { data: state.raw, path: path, agg: agg }, function (res) {
      $res.html(jsonEvalHtml(res))
      state.last = res.valid ? { path: path, agg: agg, value: res.value } : null
      $create.toggleClass('disabled', !res.valid)
    }, function (msg) {
      $res.html('<span class="text-warning"><i class="fas fa-exclamation-triangle"></i> ' + jsonEsc(msg) + '</span>')
      state.last = null
      $create.addClass('disabled')
    })
  }

  dlg.on('input', '#jp-filter', function () { clearTimeout(state.filterTimer); state.filterTimer = setTimeout(render, 200) })
  dlg.on('change', '#jp-type', function () { clearTimeout(state.filterTimer); render() })
  dlg.on('input', '#jp-test-path', function () { clearTimeout(state.testTimer); state.testTimer = setTimeout(runTest, 350) })
  dlg.on('change', '#jp-test-agg', runTest)
  dlg.on('click', '#jp-test-create', function () {
    if (!state.last) return
    addCmdToTable(jsonCmdFor(state.last.path, state.last.agg, state.last.value))
    modifyWithoutSave = true
    refreshMarks()
  })
  dlg.on('click', '#jp-reload', function () {
    jsonFetch(function (fresh) {
      state.data = fresh
      state.raw = JSON.stringify(fresh)
      render()
      if (dlg.find('#jp-test-path').val() !== '') runTest()
    })
  })
  dlg.on('click', '.jp-container .jp-toggle, .jp-container .jp-key', function () {
    var $node = $(this).closest('.jp-node')
    var $children = $node.children('.jp-children')
    if ($children.is(':visible')) {
      $children.hide()
      $node.find('> .jp-container .fa-caret-down').removeClass('fa-caret-down').addClass('fa-caret-right')
    } else {
      expand($node)
    }
  })
  dlg.on('click', '.jp-more a', function () {
    var $more = $(this).closest('.jp-more')
    var m = state.rows[$more.attr('data-rid')].more
    var $into = $more.parent()
    $more.remove()
    renderChildren(m.node, m.path, m.ctx, $into, m.next, m.depth, $(this).hasClass('jp-more-all'))
  })
  dlg.on('change', '.jp-sel', function () {
    var row = state.rows[$(this).closest('.jp-row').attr('data-rid')]
    var k = key(row.cur.path, row.cur.agg)
    if (this.checked) state.selected[k] = { path: row.cur.path, agg: row.cur.agg, value: row.d.value }
    else delete state.selected[k]
    updateFooter()
  })
  dlg.on('change', '.jp-alt', function () {
    var $row = $(this).closest('.jp-row')
    var row = state.rows[$row.attr('data-rid')]
    var $opt = $(this).find('option:selected')
    row.cur = { path: $opt.attr('data-path'), agg: $opt.attr('data-agg') }
    $row.find('.jp-path').text(row.cur.path)
    refreshMarks()
  })
  dlg.on('click', '.jp-test', function () {
    var row = state.rows[$(this).closest('.jp-row').attr('data-rid')]
    dlg.find('#jp-test-path').val(row.cur.path)
    dlg.find('#jp-test-agg').val(row.cur.agg)
    runTest()
  })
  dlg.on('click', '.jp-copy', function () {
    jsonCopy(state.rows[$(this).closest('.jp-row').attr('data-rid')].cur.path, dlg.find('.modal-body'))
  })

  render()
}

$('#bt_exploreJson').off('click').on('click', function () {
  jsonFetch(jsonOpenExplorer)
})
