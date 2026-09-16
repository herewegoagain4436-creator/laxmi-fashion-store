import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = path.join(root, 'apps/desktop/server-runtime')

function run(cmd, args, opts = {}) {
  console.log('>', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if (r.status !== 0) process.exit(r.status || 1)
}

fs.mkdirSync(runtime, { recursive: true })
run('npm', ['install', '--omit=dev'], { cwd: runtime })

// Fetch Windows native binding for better-sqlite3 (N-API prebuild)
const bsql = path.join(runtime, 'node_modules', 'better-sqlite3')
if (!fs.existsSync(bsql)) {
  console.error('better-sqlite3 missing after install')
  process.exit(1)
}

const prebuild = spawnSync(
  'npx',
  ['--yes', 'prebuild-install', '--platform', 'win32', '--arch', 'x64', '--verbose'],
  { cwd: bsql, stdio: 'inherit', shell: false, env: { ...process.env, npm_config_platform: 'win32', npm_config_arch: 'x64' } },
)

if (prebuild.status !== 0) {
  console.warn('prebuild-install for win32 failed; trying electron-builder rebuild path later')
}

// Also keep linux binding for local smoke tests — copy win binding into a known place
const releaseDir = path.join(bsql, 'build', 'Release')
fs.mkdirSync(releaseDir, { recursive: true })
const candidates = [
  path.join(bsql, 'prebuilds', 'win32-x64', 'node.napi.node'),
  path.join(bsql, 'prebuilds', 'win32-x64', 'better_sqlite3.node'),
]
for (const c of candidates) {
  if (fs.existsSync(c)) {
    const dest = path.join(releaseDir, 'better_sqlite3.node')
    // Don't overwrite linux .node if we're on linux — store win copy beside it
    const winDest = path.join(releaseDir, 'better_sqlite3.win32-x64.node')
    fs.copyFileSync(c, winDest)
    console.log('Saved Windows native binary to', winDest)
    // For packaged win build, electron-builder will use this runtime as-is on a
    // machine that already has the win .node as better_sqlite3.node
    fs.copyFileSync(c, dest)
    console.log('Installed win32 better_sqlite3.node into build/Release (for Windows package)')
    break
  }
}

console.log('Desktop server-runtime ready at', runtime)
