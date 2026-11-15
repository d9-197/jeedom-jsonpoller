/* Test navigateur (Chromium) de la fenêtre « Tester l'URL et choisir des valeurs ».
   Vraies bibliothèques (jQuery 3, Bootstrap 3, bootbox 4), vrai desktop/js/jsonpoller.js et vrai daemon pour le testeur de chemin. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..', '..')
const DAEMON_DIR = path.join(ROOT, 'resources', 'jsonpollerd')

const EVIL = '<img src=x onerror="window.__pwned=1">'
const DATA = {
  name: 'box',
  items: [
    { id: 1, v: '1.5', ok: true },
    { id: 2, v: '2,5', ok: false },
    { id: 3, v: 4, ok: true },
  ],
  nums: [10, 20, 30],
  big: Array.from({ length: 120 }, (_, i) => i),
  evil: { [EVIL]: EVIL },
  nothing: null,
}

/* Le « serveur » : testUrl renvoie DATA ; evalPath utilise la vraie fonction evaluate() du daemon. */
function serve(params) {
  if (params.action === 'testUrl') return { result: DATA }
  if (params.action === 'evalPath') {
    const py = spawnSync('python3', ['-I', '-c',
      'import sys, json; sys.path.insert(0, sys.argv[1]); import jsonpollerd as d\n' +
      'm = json.loads(sys.stdin.read()); print(json.dumps(d.evaluate(m)))', DAEMON_DIR],
      { input: JSON.stringify({ data_json: params.data, path: params.path, agg: params.agg }), encoding: 'utf8' })
    if (py.status !== 0) return { error: py.stderr }
    return { result: JSON.parse(py.stdout) }
  }
  return { error: 'action inconnue ' + params.action }
}

let browser, page, errors

/* Exécute une étape nommée : en cas d'échec, le message indique laquelle. */
async function step(name, fn) {
  try {
    return await fn()
  } catch (e) {
    e.message = `[étape « ${name} »] ${e.message}`
    throw e
  }
}

test.before(async () => {
  browser = await chromium.launch()
})
test.after(async () => { await browser.close() })

test.beforeEach(async () => {
  page = await browser.newPage()
  errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.exposeFunction('__serve', async (p) => serve(p))
  page.setDefaultTimeout(10000)
  await page.goto('file://' + path.join(__dirname, 'fixture.html'))
  // Jeedom sert le JS après avoir remplacé {{texte}} par sa traduction (ici : le français d'origine)
  const js = fs.readFileSync(path.join(ROOT, 'desktop', 'js', 'jsonpoller.js'), 'utf8').replace(/\{\{(.+?)\}\}/gs, '$1')
  await page.addScriptTag({ content: js })
})
test.afterEach(async () => {
  await page.close()
  assert.deepEqual(errors, [], 'erreurs JavaScript dans la page')
})

const openExplorer = async () => {
  await page.click('#bt_exploreJson')
  await page.waitForSelector('#jp-body .jp-row')
}
const cmdRows = () => page.$$eval('#table_cmd tbody tr.cmd', (trs) => trs.map((tr) => ({
  path: tr.querySelector('[data-l2key=jsonPath]').value,
  agg: tr.querySelector('[data-l2key=agg]').value,
  format: tr.querySelector('[data-l2key=format]').value,
  name: tr.querySelector('[data-l1key=name]').value,
  subType: tr.querySelector('.subType') ? tr.querySelector('.subType').getAttribute('subType') : null,
})))
/* Élément n de items (déplié à la demande : seul le premier niveau l'est à l'ouverture) */
const item = async (n) => {
  const node = page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("items")) > .jp-children > .jp-node').nth(n)
  if (!(await node.locator('> .jp-children').isVisible())) await node.locator('> .jp-container .jp-toggle').click()
  return node
}
const footerLabel = () => page.textContent('.bootbox .modal-footer .btn-success')

test('la fenêtre s\'ouvre : arbre, premier niveau déplié, aucun envoi de données inutile', async () => {
  await openExplorer()
  assert.equal(await page.locator('.bootbox.modal.in, .bootbox.modal.show').count(), 1)
  const keys = await page.$$eval('#jp-body > .jp-leaf > .jp-key, #jp-body > .jp-node > .jp-container > .jp-key', (e) => e.map((x) => x.textContent))
  assert.deepEqual(keys, ['name', 'items', 'nums', 'big', 'evil', 'nothing'])
  // premier niveau déplié : les éléments de items sont visibles
  assert.equal(await page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("items")) > .jp-children').isVisible(), true)
  assert.equal(await footerLabel(), 'Créer (0)')
  assert.equal(await page.locator('.bootbox .modal-footer .btn-success').isDisabled(), true)
  assert.deepEqual((await page.evaluate(() => window.__ajaxCalls)).map((c) => c.action), ['testUrl'])
})

test('déplier / replier un conteneur', async () => {
  await openExplorer()
  const node = page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("evil"))')
  assert.equal(await node.locator('> .jp-children').isVisible(), true)
  await node.locator('> .jp-container .jp-toggle').click()
  assert.equal(await node.locator('> .jp-children').isVisible(), false)
  await node.locator('> .jp-container .jp-key').click()
  assert.equal(await node.locator('> .jp-children').isVisible(), true)
})

test('sélection multiple et création des commandes (sous-type et format devinés)', async () => {
  await openExplorer()
  await page.locator('#jp-body > .jp-leaf:has(> .jp-key:text-is("name")) .jp-sel').check()
  await page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("nums")) .jp-leaf:has(> .jp-key:text-is("0")) .jp-sel').check()
  const first = await item(0)
  await first.locator('.jp-leaf:has(> .jp-key:text-is("v")) .jp-sel').check()   // "1.5" : texte numérique
  await first.locator('.jp-leaf:has(> .jp-key:text-is("ok")) .jp-sel').check()  // booléen
  assert.equal(await footerLabel(), 'Créer (4)')
  await page.click('.bootbox .modal-footer .btn-success')
  assert.equal(await page.locator('.bootbox.modal').count(), 1, 'la fenêtre reste ouverte après la création')
  const rows = await cmdRows()
  assert.deepEqual(rows.map((r) => [r.path, r.agg, r.format, r.subType]).sort(), [
    ['items[0].ok', 'first', 'auto', 'binary'],
    ['items[0].v', 'first', 'number', 'numeric'],
    ['name', 'first', 'auto', 'string'],
    ['nums[0]', 'first', 'auto', 'numeric'],
  ])
  assert.equal(await page.evaluate(() => window.modifyWithoutSave), true)
  assert.equal(await footerLabel(), 'Créer (0)')
  // les chemins créés sont marqués « déjà utilisés » et ne peuvent plus être cochés
  const name = page.locator('#jp-body > .jp-leaf:has(> .jp-key:text-is("name"))')
  assert.equal(await name.evaluate((e) => e.classList.contains('jp-used')), true)
  assert.equal(await name.locator('.jp-sel').isDisabled(), true)
})

test('menu d\'un élément de tableau : filtre par identifiant et jokers avec agrégation', async () => {
  await openExplorer()
  const second = await item(1)
  const firstChildren = page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("items")) > .jp-children > .jp-node').nth(0).locator('> .jp-children')
  assert.equal(await firstChildren.isVisible(), false, 'les autres éléments restent repliés')
  const v = second.locator('.jp-leaf:has(> .jp-key:text-is("v"))')
  const labels = await v.locator('.jp-alt option').allTextContents()
  assert.ok(labels[0].includes('[1]') && labels.some((l) => l.includes('@.id==2')) && labels.some((l) => l.includes('somme')), labels.join(' | '))
  await v.locator('.jp-alt').selectOption('filter')
  assert.equal(await v.locator('.jp-path').textContent(), 'items[?(@.id==2)].v')
  await v.locator('.jp-sel').check()
  const ok = second.locator('.jp-leaf:has(> .jp-key:text-is("id"))')
  await ok.locator('.jp-alt').selectOption('sum')
  assert.equal(await ok.locator('.jp-path').textContent(), 'items[*].id')
  await ok.locator('.jp-sel').check()
  await page.click('.bootbox .modal-footer .btn-success')
  const rows = await cmdRows()
  assert.deepEqual(rows.map((r) => [r.path, r.agg, r.subType, r.name]).sort(), [
    ['items[*].id', 'sum', 'numeric', 'id_sum'],
    ['items[?(@.id==2)].v', 'first', 'numeric', 'v'],
  ])
  // changer l'alternative met à jour l'état « utilisé »
  await v.locator('.jp-alt').selectOption('exact')
  assert.equal(await v.evaluate((e) => e.classList.contains('jp-used')), false, 'items[1].v n\'est pas encore une commande')
  await v.locator('.jp-alt').selectOption('filter')
  assert.equal(await v.evaluate((e) => e.classList.contains('jp-used')), true)
})

test('testeur de chemin (vrai daemon) : résultat, erreur, création', async () => {
  await openExplorer()
  await page.fill('#jp-test-path', 'items[*].id')
  await page.selectOption('#jp-test-agg', 'sum')
  await page.waitForSelector('#jp-test-result .text-success')
  const res = await page.textContent('#jp-test-result')
  assert.ok(res.includes('6') && res.includes('3'), res)                              // somme 6, 3 valeurs
  assert.equal(await page.locator('#jp-test-create').evaluate((e) => e.classList.contains('disabled')), false)
  await page.fill('#jp-test-path', 'items[?(@.id==3)].v')
  await page.selectOption('#jp-test-agg', 'first')
  await page.waitForFunction(() => document.querySelector('#jp-test-result').textContent.includes('4'))
  await page.fill('#jp-test-path', 'nope.zzz')
  await page.waitForSelector('#jp-test-result .text-danger')
  assert.ok((await page.textContent('#jp-test-result')).includes('introuvable'))
  assert.equal(await page.locator('#jp-test-create').evaluate((e) => e.classList.contains('disabled')), true)
  await page.fill('#jp-test-path', 'items[*].id')
  await page.selectOption('#jp-test-agg', 'avg')
  await page.waitForSelector('#jp-test-result .text-success')
  await page.click('#jp-test-create')
  assert.deepEqual((await cmdRows()).map((r) => [r.path, r.agg, r.subType]), [['items[*].id', 'avg', 'numeric']])
})

test('le bouton « tester » d\'une ligne remplit le testeur', async () => {
  await openExplorer()
  await page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("nums")) .jp-leaf:has(> .jp-key:text-is("2")) .jp-test').click()
  assert.equal(await page.inputValue('#jp-test-path'), 'nums[2]')
  await page.waitForSelector('#jp-test-result .text-success')
  assert.ok((await page.textContent('#jp-test-result')).includes('30'))
})

test('filtres : texte, type, aucun résultat, retour à l\'arbre', async () => {
  await openExplorer()
  const leafPaths = () => page.$$eval('#jp-body .jp-leaf .jp-path', (e) => e.map((x) => x.textContent))
  const waitPaths = (expected) => page.waitForFunction((exp) =>
    JSON.stringify([...document.querySelectorAll('#jp-body .jp-leaf .jp-path')].map((x) => x.textContent)) === JSON.stringify(exp), expected)
  await step('filtre texte', async () => {
    await page.fill('#jp-filter', 'items[1]')
    await waitPaths(['items[1].id', 'items[1].v', 'items[1].ok'])
    assert.equal(await page.locator('#jp-body .jp-key').count(), 0, 'pas de nom de clé en mode liste')
  })
  await step('filtre booléens', async () => {
    await page.fill('#jp-filter', '')
    await page.selectOption('#jp-type', 'boolean')
    await waitPaths(['items[0].ok', 'items[1].ok', 'items[2].ok'])
  })
  await step('filtre null', async () => {
    await page.selectOption('#jp-type', 'null')
    await waitPaths(['nothing'])
  })
  await step('aucun résultat', async () => {
    await page.fill('#jp-filter', 'zzzzzz')
    await page.waitForFunction(() => document.querySelector('#jp-body').textContent.includes('Aucune valeur'))
    assert.deepEqual(await leafPaths(), [])
  })
  await step('retour à l\'arbre', async () => {
    await page.fill('#jp-filter', '')
    await page.selectOption('#jp-type', 'all')
    await page.waitForFunction(() => document.querySelectorAll('#jp-body > .jp-node').length === 4)
  })
  await step('minuteurs séparés filtre / testeur', async () => {
    await page.fill('#jp-filter', 'nums[1]')
    await page.fill('#jp-test-path', 'nums[0]')
    await waitPaths(['nums[1]'])
    await page.waitForFunction(() => document.querySelector('#jp-test-result').textContent.includes('10'))
  })
})

test('grand tableau : pagination par 50, « tout afficher »', async () => {
  await openExplorer()
  const big = page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("big")) > .jp-children')
  assert.equal(await big.locator('> .jp-leaf').count(), 50)
  assert.ok((await big.locator('> .jp-more').textContent()).includes('70'))
  await big.locator('.jp-more-next').click()
  assert.equal(await big.locator('> .jp-leaf').count(), 100)
  assert.ok((await big.locator('> .jp-more').textContent()).includes('20'))
  await big.locator('.jp-more-all').click()
  assert.equal(await big.locator('> .jp-leaf').count(), 120)
  assert.equal(await big.locator('> .jp-more').count(), 0)
  // l'ordre est conservé
  const first = await big.locator('> .jp-leaf .jp-path').first().textContent()
  const last = await big.locator('> .jp-leaf .jp-path').last().textContent()
  assert.deepEqual([first, last], ['big[0]', 'big[119]'])
})

test('sécurité : le contenu distant n\'est jamais interprété comme du HTML', async () => {
  await openExplorer()
  await page.fill('#jp-filter', 'onerror')
  await page.waitForFunction(() => document.querySelectorAll('#jp-body .jp-leaf').length >= 1)
  assert.equal(await page.locator('#jp-body img').count(), 0)
  assert.equal(await page.evaluate(() => window.__pwned), undefined)
  assert.ok((await page.textContent('#jp-body')).includes('<img src=x'), 'le texte est affiché tel quel')
  await page.fill('#jp-filter', '')
  await page.waitForSelector('#jp-body > .jp-node')
  assert.equal(await page.locator('#jp-body img').count(), 0)
  assert.equal(await page.evaluate(() => window.__pwned), undefined)
})

test('recharger relit la source et conserve le testeur', async () => {
  await openExplorer()
  await page.fill('#jp-test-path', 'nums[*]')
  await page.selectOption('#jp-test-agg', 'sum')
  await page.waitForSelector('#jp-test-result .text-success')
  await page.click('#jp-reload')
  await page.waitForFunction(() => window.__ajaxCalls.filter((c) => c.action === 'testUrl').length === 2)
  await page.waitForSelector('#jp-body > .jp-node')
  assert.equal(await page.inputValue('#jp-test-path'), 'nums[*]')
})

test('copier le chemin : repli sans presse-papiers sécurisé (Jeedom en http)', async () => {
  await openExplorer()
  await page.evaluate(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false })
    window.__copied = null
    document.execCommand = () => { window.__copied = document.activeElement.value; return true }
  })
  await page.locator('#jp-body > .jp-leaf:has(> .jp-key:text-is("name")) .jp-copy').click()
  assert.equal(await page.evaluate(() => window.__copied), 'name')
  assert.equal(await page.locator('.bootbox textarea').count(), 0, 'le champ temporaire est retiré')
})

test('copier le chemin : presse-papiers sécurisé refusé => repli', async () => {
  await openExplorer()
  await page.evaluate(() => {
    Object.defineProperty(window, 'isSecureContext', { value: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refusé')) } })
    window.__copied = null
    document.execCommand = () => { window.__copied = document.activeElement.value; return true }
  })
  await page.locator('#jp-body > .jp-node:has(> .jp-container > .jp-key:text-is("nums")) .jp-leaf:has(> .jp-key:text-is("1")) .jp-copy').click()
  await page.waitForFunction(() => window.__copied !== null)
  assert.equal(await page.evaluate(() => window.__copied), 'nums[1]')
})
