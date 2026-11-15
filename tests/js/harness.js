// Charge desktop/js/jsonpoller.js dans un bac à sable avec de faux jQuery / API Jeedom.
const fs = require('fs')
const path = require('path')
const vm = require('vm')

function load() {
  const calls = { appended: [], setValues: [], changeType: [], selectors: [] }
  const el = {}
  for (const m of ['off', 'on', 'toggle', 'text', 'html', 'val', 'attr', 'addClass', 'find', 'each']) el[m] = () => el
  el.last = () => el
  el.value = () => 'none'
  el.append = (html) => { calls.appended.push(html); return el }
  el.setValues = (obj, sel) => { calls.setValues.push([obj, sel]); return el }
  const sandbox = {
    $: (sel) => { calls.selectors.push(sel); return el },
    jeedom: {
      cmd: {
        availableType: () => '<select class="cmdAttr" data-l1key="type"></select>',
        changeType: (tr, subType) => calls.changeType.push(subType),
      },
    },
    init: (v) => (v === undefined || v === null ? '' : v),
    isset: (v) => typeof v !== 'undefined',
    is_numeric: (v) => !isNaN(parseFloat(v)) && isFinite(v),
    bootbox: {}, jeedomUtils: {}, modifyWithoutSave: false,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'js', 'jsonpoller.js'), 'utf8'), sandbox,
    { filename: 'jsonpoller.js' })
  sandbox.calls = calls
  return sandbox
}

module.exports = { load }
