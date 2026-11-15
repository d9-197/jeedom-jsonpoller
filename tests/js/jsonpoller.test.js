const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./harness')

test('jsonPathKey : syntaxe des chemins', () => {
  const ui = load()
  const cases = [
    ['', 'a', 'a'], ['a', 'b', 'a.b'], ['a', 0, 'a[0]'], ['', 0, '[0]'], ['a[0]', 'v', 'a[0].v'],
    ['', 'with space', 'with space'], ['a', 'dash-key', 'a.dash-key'], ['a', 'ünï', 'a.ünï'],
    ['a', 'x.y', 'a["x.y"]'], ['a', "it's", 'a["it\'s"]'], ['a', 'q"d', "a['q\"d']"],
    ['a', '*', 'a["*"]'], ['', '$x', '["$x"]'], ['a', '$x', 'a.$x'], ['a', ' lead', 'a[" lead"]'],
    ['a', 'trail ', 'a["trail "]'], ['a', '', 'a[""]'], ['a', 'with]bracket', 'a["with]bracket"]'],
  ]
  for (const [parent, key, expected] of cases) assert.equal(ui.jsonPathKey(parent, key), expected, JSON.stringify([parent, key]))
  assert.equal(ui.jsonPathKey('a', `both"and'`), null)   // inexprimable
})

test('flattenJson : feuilles, tableaux tronqués, limite, clés inexprimables ignorées', () => {
  const ui = load()
  const rows = []
  ui.flattenJson({ a: { b: 1, c: [true, null] }, s: 'x', [`bad"'`]: 9 }, '', rows, 1000)
  assert.deepEqual(rows.map((r) => [r.path, r.value]), [['a.b', 1], ['a.c[0]', true], ['a.c[1]', null], ['s', 'x']])

  const big = []
  ui.flattenJson({ l: Array.from({ length: 80 }, (_, i) => i) }, '', big, 1000)
  assert.equal(big.length, 50)                           // tableaux limités à 50 éléments

  const limited = []
  ui.flattenJson({ l: Array.from({ length: 40 }, (_, i) => i) }, '', limited, 10)
  assert.equal(limited.length, 10)

  const scalar = []
  ui.flattenJson(42, '', scalar, 10)
  assert.deepEqual(JSON.parse(JSON.stringify(scalar)), [{ path: '', value: 42 }])    // racine scalaire : chemin vide
})

test('jsonSubType : détection du sous-type et du format', () => {
  const ui = load()
  const cases = [
    [21.5, 'numeric', 'auto'], [0, 'numeric', 'auto'],
    ['0.00', 'numeric', 'number'], ['1,5', 'numeric', 'number'], [' -4 ', 'numeric', 'number'], ['+7', 'numeric', 'number'],
    ['21.5 °C', 'string', 'auto'], ['abc', 'string', 'auto'], ['', 'string', 'auto'], ['1e3', 'string', 'auto'],
    [true, 'binary', 'auto'], [false, 'binary', 'auto'], [null, 'string', 'auto'],
  ]
  for (const [value, subType, format] of cases) {
    assert.deepEqual({ ...ui.jsonSubType(value) }, { subType, format }, JSON.stringify(value))
  }
})

test('jsonCmdName : nom proposé pour une commande', () => {
  const ui = load()
  const cases = [['data.temp', 'temp'], ['items[0].value', 'value'], ['a["x"]', 'x'], ['list[2]', 'list_2'], ['', 'valeur'], ['Irms', 'Irms'], ["a['y']", 'y'], ['m[0][1]', 'm_0_1'], ['a[""]', 'valeur'], ['x.y.z', 'z']]
  for (const [path, name] of cases) assert.equal(ui.jsonCmdName(path), name, path)
})

test('addCmdToTable : ligne d\'une commande info', () => {
  const ui = load()
  ui.addCmdToTable({ id: 12, type: 'info', subType: 'numeric', name: 'irms', configuration: { jsonPath: 'Irms' } })
  const html = ui.calls.appended[0]
  for (const field of ['jsonPath', 'format', 'agg', 'factor', 'offset', 'decimals', 'minValue', 'maxValue', 'unite', 'isHistorized']) {
    assert.ok(html.includes(`data-l2key="${field}"`) || html.includes(`data-l1key="${field}"`), `champ ${field} absent`)
  }
  assert.ok(html.includes('data-cmd_id="12"'))
  assert.ok(html.includes('data-action="test"'), 'bouton Tester pour une commande déjà enregistrée')
  assert.ok(html.includes('data-action="remove"'))
  assert.deepEqual(ui.calls.changeType, ['numeric'])
  assert.equal(ui.calls.setValues[0][0].configuration.jsonPath, 'Irms')
})

test('addCmdToTable : nouvelle commande, commande interne, action', () => {
  const ui = load()
  ui.addCmdToTable({ type: 'info', subType: 'string', configuration: { jsonPath: 'a' } })
  assert.ok(!ui.calls.appended[0].includes('data-action="test"'), 'pas de bouton Tester avant la sauvegarde')

  ui.addCmdToTable({ id: 5, type: 'info', subType: 'string', logicalId: '_error', configuration: {} })
  const internal = ui.calls.appended[1]
  assert.ok(internal.includes('data-l2key') && !internal.includes('data-l2key="jsonPath"'), 'pas de chemin pour une commande interne')
  assert.ok(!internal.includes('data-action="remove"'), 'une commande interne ne se supprime pas')

  ui.addCmdToTable({ id: 6, type: 'action', subType: 'other', logicalId: 'refresh', configuration: {} })
  const action = ui.calls.appended[2]
  assert.ok(!action.includes('data-l2key="jsonPath"') && !action.includes('data-l2key="format"'))

  ui.addCmdToTable()                                     // sans argument : ne doit pas planter
  assert.equal(ui.calls.appended.length, 4)
})

test('chaque option de format / agrégation du tableau est connue du plugin', () => {
  const ui = load()
  ui.addCmdToTable({ id: 1, type: 'info', subType: 'numeric', configuration: {} })
  const html = ui.calls.appended[0]
  const optionsOf = (key) => {
    const m = html.match(new RegExp(`data-l2key="${key}"[^>]*>(.*?)</select>`, 's'))
    return [...m[1].matchAll(/value="([^"]+)"/g)].map((x) => x[1])
  }
  assert.deepEqual(optionsOf('format'), ['auto', 'number', 'boolean', 'string'])
  assert.deepEqual(optionsOf('agg'), ['first', 'last', 'sum', 'avg', 'min', 'max', 'count', 'list'])
})
