import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const watch = process.argv.includes('--watch')
// only the package's own output: dist/site belongs to the website build
for (const d of ['web', 'types']) fs.rmSync(`dist/${d}`, { recursive: true, force: true })
fs.mkdirSync('dist/web', { recursive: true })

const node = { bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, logLevel: 'warning' }

await Promise.all([
  build({ ...node, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', banner: { js: '#!/usr/bin/env node' } }),
  build({ ...node, entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js' }),
  build({ ...node, entryPoints: ['src/collector/server.ts'], outfile: 'dist/collector.js', banner: { js: '#!/usr/bin/env node' } }),
  build({ ...node, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' }),
  build({
    entryPoints: ['web/src/main.tsx'],
    outfile: 'dist/web/app.js',
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: !watch,
    logLevel: 'warning',
  }),
])
// The mark is drawn from one definition; static HTML gets it inlined at build time.
const { markSvg } = await import('../web/src/mark.ts')
const favicon = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='#0b0b0a'/><g transform='translate(3.2 3.2) scale(0.8)'>${markSvg(32, '#f6f1e8', '#ff6a2b').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`,
)}`
const brand = (html) => html.replace(/\{\{mark:(\d+)\}\}/g, (_, n) => markSvg(Number(n))).replaceAll('{{favicon}}', favicon)
const copyHtml = (from, to, fix = (h) => h) => fs.writeFileSync(to, fix(brand(fs.readFileSync(from, 'utf8'))))

for (const f of ['styles.css', 'tokens.css']) fs.copyFileSync(`web/${f}`, `dist/web/${f}`)
copyHtml('web/index.html', 'dist/web/index.html')
// Self-hosted fonts: the report makes no third-party requests.
fs.mkdirSync('dist/web/fonts', { recursive: true })
for (const [pkg, files] of [
  ['ibm-plex-sans', ['latin-300-normal', 'latin-400-normal', 'latin-400-italic', 'latin-500-normal', 'latin-600-normal']],
  ['ibm-plex-mono', ['latin-400-normal', 'latin-500-normal']],
]) {
  for (const f of files) fs.copyFileSync(`node_modules/@fontsource/${pkg}/files/${pkg}-${f}.woff2`, `dist/web/fonts/${pkg}-${f}.woff2`)
}
fs.copyFileSync('node_modules/@fontsource/ibm-plex-sans/LICENSE', 'dist/web/fonts/OFL-IBM-Plex.txt')

// Type declarations for the Node API, with import specifiers consumers can resolve.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.types.json'], { stdio: 'inherit' })
const fixSpecifiers = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = `${dir}/${f}`
    if (fs.statSync(p).isDirectory()) fixSpecifiers(p)
    else if (p.endsWith('.d.ts')) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2').replace(/(import\(['"]\.{1,2}\/[^'"]+)\.ts(['"]\))/g, '$1.js$2'))
  }
}
fixSpecifiers('dist/types')

fs.chmodSync('dist/cli.js', 0o755)
fs.chmodSync('dist/collector.js', 0o755)
console.log('built dist/')
