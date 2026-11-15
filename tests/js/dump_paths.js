// Lit un JSON sur stdin et écrit [{path, value}, ...] tel que l'explorateur de l'interface le génère.
const { load } = require('./harness')
const ui = load()
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'))
const rows = []
ui.flattenJson(data, '', rows, 1000)
process.stdout.write(JSON.stringify(rows))
