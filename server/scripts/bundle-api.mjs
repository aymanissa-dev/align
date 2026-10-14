import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outfile = resolve(root, 'api/index.js')

await mkdir(dirname(outfile), { recursive: true })

await build({
  entryPoints: [resolve(root, 'server/src/vercel.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  legalComments: 'none',
  logLevel: 'info',
})

const source = await readFile(outfile, 'utf8')
if (/\.tsx?(?:['"])/.test(source)) {
  throw new Error('API bundle still imports TypeScript source.')
}

console.log(`Bundled API to ${outfile}`)
