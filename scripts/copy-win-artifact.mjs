import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'apps/desktop/release-build')
const release = path.join(root, 'release')
fs.mkdirSync(release, { recursive: true })

if (!fs.existsSync(outDir)) {
  console.error('No electron-builder output at', outDir)
  process.exit(1)
}

const files = fs.readdirSync(outDir)
const artifacts = files.filter((f) => /\.(exe|zip|msi)$/i.test(f) || f.endsWith('.exe'))
console.log('Builder outputs:', files)

for (const f of artifacts) {
  const src = path.join(outDir, f)
  const dest = path.join(release, f)
  fs.copyFileSync(src, dest)
  const st = fs.statSync(dest)
  console.log(`Copied ${dest} (${(st.size / 1024 / 1024).toFixed(2)} MB)`)
}

// Prefer clear names
const portable = artifacts.find((f) => /portable/i.test(f) || f.endsWith('.exe'))
if (portable) {
  const alias = path.join(release, 'LaxmiFashion-Portable.exe')
  fs.copyFileSync(path.join(outDir, portable), alias)
  console.log('Alias:', alias)
}
