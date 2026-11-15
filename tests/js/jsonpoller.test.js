const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./harness')

// Les objets créés dans le bac à sable (vm) ont un autre prototype : on compare des copies JSON.
const plain = (x) => JSON.parse(JSON.stringify(x))

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

const DATA = {
  name: 'box',
  items: [
    { id: 1, v: '1.5', ok: true, 'a.b': 'x' },
    { id: 2, v: '2,5', ok: false, 'a.b': 'y' },
    { id: 3, v: 4, ok: true, 'a.b': 'z' },
  ],
  nums: [10, 20, 30],
  deep: { list: [{ id: 'a', n: { x: 1 } }, { id: 'b', n: { x: 2 } }] },
  nothing: null,
}

test('jsonIdLiteral / jsonIdField : identifiant d\'un tableau d\'objets', () => {
  const ui = load()
  assert.equal(ui.jsonIdLiteral(3), '3')
  assert.equal(ui.jsonIdLiteral('a b'), '"a b"')
  assert.equal(ui.jsonIdLiteral('x)]y'), null)               // casserait le filtre
  assert.equal(ui.jsonIdLiteral(true), null)
  assert.equal(ui.jsonIdLiteral(null), null)
  assert.equal(ui.jsonIdLiteral(NaN), null)
  assert.equal(ui.jsonIdField(DATA.items), 'id')
  assert.equal(ui.jsonIdField([{ name: 'a' }, { name: 'b' }]), 'name')
  assert.equal(ui.jsonIdField([{ id: 1 }, { id: 1 }]), null)  // doublon : pas un identifiant
  assert.equal(ui.jsonIdField([{ id: 1 }, { nom: 'b' }]), null) // absent d'un élément
  assert.equal(ui.jsonIdField([{ id: 1 }, 5]), null)
  assert.equal(ui.jsonIdField([]), null)
  assert.equal(ui.jsonIdField([1, 2]), null)
})

test('jsonChildren : objet, tableau, pagination, contexte et alternatives', () => {
  const ui = load()
  const root = plain(ui.jsonChildren(DATA, '', null, 0, 50))
  assert.equal(root.total, 5)
  assert.deepEqual(root.items.map((d) => [d.key, d.path, d.kind]),
    [['name', 'name', 'leaf'], ['items', 'items', 'arr'], ['nums', 'nums', 'arr'], ['deep', 'deep', 'obj'], ['nothing', 'nothing', 'leaf']])
  assert.equal(root.items[1].size, 3)
  assert.equal(root.items[3].size, 1)

  const items = plain(ui.jsonChildren(DATA.items, 'items', null, 0, 50))
  assert.equal(items.items[0].path, 'items[0]')
  assert.deepEqual(items.items[1].ctx, { arrayPath: 'items', index: 1, rel: '', sel: '?(@.id==2)' })

  // feuille dans un élément : chemin exact + filtre par id + tous les éléments
  const leaf = plain(ui.jsonChildren(DATA.items[0], 'items[0]', items.items[0].ctx, 0, 50)).items[1]
  assert.equal(leaf.path, 'items[0].v')
  const alts = Object.fromEntries(leaf.alts.map((a) => [a.id, [a.path, a.agg]]))
  assert.deepEqual(alts.filter, ['items[?(@.id==1)].v', 'first'])
  assert.deepEqual(alts.sum, ['items[*].v', 'sum'])
  assert.ok(alts.avg && alts.min && alts.max && alts.count && alts.list, 'valeur numérique ("1.5") : agrégations numériques proposées')
  assert.ok(!alts.first, 'pas de « première » pour une valeur numérique')

  // clé spéciale dans un élément : le chemin relatif garde la syntaxe entre crochets
  const special = plain(ui.jsonChildren(DATA.items[0], 'items[0]', items.items[0].ctx, 0, 50)).items[3]
  assert.equal(special.path, 'items[0]["a.b"]')
  assert.equal(special.alts.find((a) => a.id === 'filter').path, 'items[?(@.id==1)]["a.b"]')
  assert.deepEqual(special.alts.map((a) => a.id), ['filter', 'first', 'last', 'count', 'list'])   // texte : pas de somme

  // tableau de nombres : pas de filtre (pas d'identifiant), agrégations sur [*]
  const nums = plain(ui.jsonChildren(DATA.nums, 'nums', null, 1, 1))
  assert.equal(nums.items.length, 1)
  assert.equal(nums.items[0].path, 'nums[1]')
  assert.deepEqual(nums.items[0].alts.map((a) => [a.id, a.path]), [['sum', 'nums[*]'], ['avg', 'nums[*]'], ['min', 'nums[*]'], ['max', 'nums[*]'], ['count', 'nums[*]'], ['list', 'nums[*]']])

  // tableau dans un objet dans un tableau : le contexte le plus proche gagne
  const inner = plain(ui.jsonChildren(DATA.deep.list, 'deep.list', null, 0, 50))
  assert.equal(inner.items[1].ctx.sel, '?(@.id=="b")')
  const nNode = plain(ui.jsonChildren(DATA.deep.list[1], 'deep.list[1]', inner.items[1].ctx, 0, 50)).items[1]   // le conteneur n
  assert.equal(nNode.ctx.rel, 'n')
  const x = plain(ui.jsonChildren(DATA.deep.list[1].n, 'deep.list[1].n', nNode.ctx, 0, 50)).items[0]
  assert.equal(x.path, 'deep.list[1].n.x')
  assert.equal(x.alts.find((a) => a.id === 'filter').path, 'deep.list[?(@.id=="b")].n.x')
  assert.equal(x.alts.find((a) => a.id === 'sum').path, 'deep.list[*].n.x')

  // pagination
  const big = Array.from({ length: 120 }, (_, i) => i)
  const page = plain(ui.jsonChildren(big, 'l', null, 100, 50))
  assert.equal(page.total, 120)
  assert.equal(page.items.length, 20)
  assert.equal(page.items[0].path, 'l[100]')
})

test('jsonLeaves : filtres de texte et de type, limite, racine scalaire', () => {
  const ui = load()
  const paths = (o) => plain(ui.jsonLeaves(DATA, o).leaves).map((d) => d.path)
  assert.equal(paths({}).length, 1 + 12 + 3 + 4 + 1)                    // toutes les feuilles, sans limite de 50 par tableau
  assert.deepEqual(paths({ type: 'boolean' }), ['items[0].ok', 'items[1].ok', 'items[2].ok'])
  assert.deepEqual(paths({ type: 'null' }), ['nothing'])
  assert.deepEqual(paths({ type: 'numeric' }).filter((p) => p.startsWith('nums')), ['nums[0]', 'nums[1]', 'nums[2]'])
  assert.ok(paths({ type: 'numeric' }).includes('items[0].v'), 'texte numérique ("1.5") compté comme nombre')
  assert.ok(!paths({ type: 'string' }).includes('items[0].v'))
  assert.ok(paths({ type: 'string' }).includes('name'))
  assert.deepEqual(paths({ text: 'NUMS[2' }), ['nums[2]'])              // insensible à la casse, dans le chemin
  assert.deepEqual(paths({ text: 'box' }), ['name'])                    // ... ou dans la valeur

  const limited = plain(ui.jsonLeaves(DATA, { limit: 5 }))
  assert.equal(limited.leaves.length, 5)
  assert.equal(limited.truncated, true)
  assert.equal(plain(ui.jsonLeaves(DATA, { limit: 1000 })).truncated, false)

  assert.deepEqual(plain(ui.jsonLeaves(42, {})).leaves.map((d) => [d.path, d.value]), [['', 42]])
  const long = Array.from({ length: 1200 }, (_, i) => i)                // plus de 500 : pagination interne
  assert.equal(plain(ui.jsonLeaves(long, { limit: 5000 })).leaves.length, 1200)
})

test('jsonCmdFor : commande créée selon le chemin et l\'agrégation', () => {
  const ui = load()
  assert.deepEqual(plain(ui.jsonCmdFor('Irms', 'first', '0.00')),
    { type: 'info', subType: 'numeric', name: 'Irms', isVisible: 1, configuration: { jsonPath: 'Irms', format: 'number', agg: 'first' } })
  assert.deepEqual(plain(ui.jsonCmdFor('items[*].v', 'sum', '1.5')),
    { type: 'info', subType: 'numeric', name: 'v_sum', isVisible: 1, configuration: { jsonPath: 'items[*].v', format: 'auto', agg: 'sum' } })
  assert.equal(ui.jsonCmdFor('items[*].n', 'list', 'a').subType, 'string')
  assert.equal(ui.jsonCmdFor('items[*].n', 'count', 'a').subType, 'numeric')
  assert.equal(ui.jsonCmdFor('items[*].ok', 'last', true).subType, 'binary')
  assert.equal(ui.jsonCmdFor('x', undefined, 'abc').configuration.agg, 'first')
})

test('jsonIsUsed : chemin déjà utilisé par une commande', () => {
  const ui = load()
  const existing = [{ path: 'a', agg: 'first' }, { path: 'b[*]', agg: 'sum' }, { path: 'c' }]
  assert.equal(ui.jsonIsUsed(existing, 'a', 'first'), true)
  assert.equal(ui.jsonIsUsed(existing, 'a', 'sum'), false)
  assert.equal(ui.jsonIsUsed(existing, 'b[*]', 'sum'), true)
  assert.equal(ui.jsonIsUsed(existing, 'c', undefined), true)          // agg absent = first
  assert.equal(ui.jsonIsUsed([], 'a', 'first'), false)
})

test('HTML : les valeurs et chemins distants sont échappés (pas d\'injection)', () => {
  const ui = load()
  const evil = '<img src=x onerror=alert(1)>"\'&'
  assert.equal(ui.jsonEsc(evil), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;')
  const d = { key: evil, path: evil, kind: 'leaf', value: evil, ctx: null }
  const row = ui.jsonRowHtml(d, { rid: 1, flat: false, used: false, checked: false })
  assert.ok(!row.includes('<img'), 'balise injectée dans la ligne')
  assert.ok(!/ onerror=/.test(row.replace(/&lt;img src=x onerror=/g, '')), 'attribut injecté')
  const node = ui.jsonContainerHtml({ key: evil, kind: 'obj', size: 1 }, 2)
  assert.ok(!node.includes('<img'))
  const res = ui.jsonEvalHtml({ valid: false, error: evil })
  assert.ok(!res.includes('<img'))
  assert.ok(!ui.jsonEvalHtml({ valid: true, value: evil, multi: false }).includes('<img'))
  // attribut data-path d'une alternative
  const alt = { key: 'v', path: 'a[0].v', kind: 'leaf', value: 1, ctx: { arrayPath: 'a', index: 0, rel: 'v', sel: null },
    alts: [{ id: 'sum', path: 'a["' + evil + '"][*]', agg: 'sum' }] }
  assert.ok(!ui.jsonRowHtml(alt, { rid: 1 }).includes('<img'))
})

test('HTML : ligne feuille — cases, état « déjà utilisée », menu d\'alternatives', () => {
  const ui = load()
  const leaf = plain(ui.jsonChildren(DATA.items[0], 'items[0]', plain(ui.jsonChildren(DATA.items, 'items', null, 0, 5)).items[0].ctx, 0, 5)).items[1]
  const row = ui.jsonRowHtml(leaf, { rid: 7, flat: false, used: false, checked: true })
  assert.ok(row.includes('data-rid="7"') && row.includes('class="jp-sel" checked'))
  assert.ok(row.includes('<select class="jp-alt'), 'menu d\'alternatives dans un tableau')
  assert.ok(row.includes('data-path="items[?(@.id==1)].v"'))
  assert.ok(row.includes('jp-t-string'), '"1.5" est un texte JSON, affiché comme tel')
  assert.ok(row.includes('&quot;1.5&quot;'), 'les textes gardent leurs guillemets')
  const used = ui.jsonRowHtml(leaf, { rid: 1, flat: true, used: true, checked: false })
  assert.ok(used.includes('jp-used') && used.includes('disabled'))
  assert.ok(!used.includes('class="jp-key"'), 'pas de nom de clé en mode liste')
  const noArray = ui.jsonRowHtml({ key: 'name', path: 'name', kind: 'leaf', value: 'box', ctx: null }, { rid: 1 })
  assert.ok(!noArray.includes('jp-alt'), 'pas de menu hors tableau')
  const num = ui.jsonRowHtml({ key: 'n', path: 'n', kind: 'leaf', value: 5, ctx: null }, { rid: 1 })
  assert.ok(num.includes('jp-t-numeric'))
})

test('HTML : conteneur, pagination, résultat du testeur', () => {
  const ui = load()
  assert.ok(ui.jsonContainerHtml({ key: 'items', kind: 'arr', size: 12 }, 3).includes('[12]'))
  assert.ok(ui.jsonContainerHtml({ key: 'deep', kind: 'obj', size: 4 }, 3).includes('{4}'))
  const more = ui.jsonMoreHtml(9, 70)
  assert.ok(more.includes('data-rid="9"') && more.includes('(70 ') && more.includes('jp-more-all'))
  assert.ok(ui.jsonEvalHtml({ valid: true, value: 6, multi: true, matches: 3 }).includes('3 '))
  assert.ok(ui.jsonEvalHtml({ valid: true, value: '0.00', multi: false }).includes('&quot;0.00&quot;'))
  assert.ok(ui.jsonEvalHtml({ valid: false, error: 'introuvable' }).includes('text-danger'))
  const long = ui.jsonShow('x'.repeat(500), 50)
  assert.equal(long.length, 51)                                         // tronqué avec « … »
  assert.equal(ui.jsonShow(undefined), 'null')
})

test('jsonAggOptions : mêmes valeurs que le plugin (tableau des commandes et testeur)', () => {
  const ui = load()
  const values = [...ui.jsonAggOptions().matchAll(/value="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(values, ['first', 'last', 'sum', 'avg', 'min', 'max', 'count', 'list'])
})
