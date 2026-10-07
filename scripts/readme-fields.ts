// Rewrites the README's field table from FIELD_DOCS, so the list people audit against is the
// list the code sends. Run after changing a field: node scripts/readme-fields.ts
import fs from 'node:fs'
import { FIELD_DOCS, REPO_FIELDS } from '../src/pipeline/indexAgg.ts'

const file = new URL('../README.md', import.meta.url)
const md = fs.readFileSync(file, 'utf8')
const head = '| Field | What it is |\n| --- | --- |\n'
const start = md.indexOf(head)
if (start < 0) throw new Error('README field table not found')
const end = md.indexOf('\n\n', start)
const repo = new Set<string>(REPO_FIELDS)
const row = ([k, d]: [string, string]) => `| \`${k}\` | ${d.replace(/ \(repo stats only\)$/, '')}${repo.has(k) ? ' *(repo stats only)*' : ''} |`
const rows = Object.entries(FIELD_DOCS).map(row).join('\n')
fs.writeFileSync(file, md.slice(0, start) + head + rows + md.slice(end))
console.log(`README: ${Object.keys(FIELD_DOCS).length} fields (${repo.size} repo-stats only)`)
