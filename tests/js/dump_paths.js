// Lit un JSON sur stdin et écrit, pour chaque feuille telle que l'explorateur la propose,
// son chemin exact et ses alternatives (filtre, jokers) : [{path, value, index, alts:[{id,path,agg}]}]
const { load } = require('./harness')
const ui = load()
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'))
const res = ui.jsonLeaves(data, { limit: 5000 })
process.stdout.write(JSON.stringify(res.leaves.map((d) => ({
  path: d.path, value: d.value, index: d.ctx ? d.ctx.index : null, alts: d.alts || [],
}))))
