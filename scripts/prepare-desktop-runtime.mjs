/**
 * Prepare apps/desktop/server-runtime with production deps and a
 * Windows x64 better-sqlite3 binary built for Electron (not system Node).
 *
 * Electron main (apps/desktop/electron/main.cjs) loads the server via
 * import() inside the Electron process — so better-sqlite3 MUST match
 * Electron's NODE_MODULE_VERSION (Electron 33.x → ABI 130), not Node 20 (115).
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = path.join(root, 'apps/desktop/server-runtime')
const PLATFORM = 'win32'
const ARCH = 'x64'
/** Electron 33.x ABI — must stay in sync with apps/desktop electron dep */
const EXPECTED_ELECTRON_ABI = 130

function run(cmd, args, opts = {}) {
  console.log('>', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if (r.status !== 0) process.exit(r.status || 1)
}

function readElectronVersion() {
  const desktopPkg = JSON.parse(
    fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8'),
  )
  const v = desktopPkg.devDependencies?.electron || desktopPkg.dependencies?.electron
  if (!v) throw new Error('electron version missing from apps/desktop/package.json')
  return String(v).replace(/^[^0-9]*/, '')
}

function resolveAbi(electronVersion) {
  try {
    const nodeAbi = require(path.join(root, 'node_modules/node-abi'))
    const abi = Number(nodeAbi.getAbi(electronVersion, 'electron'))
    if (!Number.isFinite(abi)) throw new Error('invalid abi')
    return abi
  } catch (err) {
    console.warn('node-abi lookup failed, falling back to expected ABI', EXPECTED_ELECTRON_ABI, err.message)
    return EXPECTED_ELECTRON_ABI
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function download(url) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      https
        .get(u, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            if (redirects > 8) return reject(new Error('too many redirects'))
            res.resume()
            return get(res.headers.location, redirects + 1)
          }
          if (res.statusCode !== 200) {
            res.resume()
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          }
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
          res.on('error', reject)
        })
        .on('error', reject)
    }
    get(url)
  })
}

async function fetchOfficialElectronPrebuild(bsqlVersion, abi) {
  const asset = `better-sqlite3-v${bsqlVersion}-electron-v${abi}-${PLATFORM}-${ARCH}.tar.gz`
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bsqlVersion}/${asset}`
  console.log('Verifying against official asset:', url)
  const buf = await download(url)
  // tar.gz contains build/Release/better_sqlite3.node — extract with tar
  const tmpDir = fs.mkdtempSync(path.join(runtime, '.abi-check-'))
  const tarPath = path.join(tmpDir, asset)
  fs.writeFileSync(tarPath, buf)
  const extract = spawnSync('tar', ['-xzf', tarPath, '-C', tmpDir], { encoding: 'utf8' })
  if (extract.status !== 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    throw new Error(`Failed to extract ${asset}: ${extract.stderr || extract.stdout}`)
  }
  const candidates = [
    path.join(tmpDir, 'build', 'Release', 'better_sqlite3.node'),
    path.join(tmpDir, 'better_sqlite3.node'),
  ]
  const found = candidates.find((c) => fs.existsSync(c))
  if (!found) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    throw new Error(`better_sqlite3.node not found inside ${asset}`)
  }
  const hash = sha256File(found)
  const size = fs.statSync(found).size
  fs.rmSync(tmpDir, { recursive: true, force: true })
  return { asset, url, hash, size }
}

function assertElectronAbiBinary(nodePath, expected) {
  if (!fs.existsSync(nodePath)) {
    throw new Error(`Missing native binding at ${nodePath}`)
  }
  const size = fs.statSync(nodePath).size
  if (size < 100_000) {
    throw new Error(`Native binding suspiciously small (${size} bytes): ${nodePath}`)
  }
  const actualHash = sha256File(nodePath)
  if (actualHash !== expected.hash) {
    throw new Error(
      [
        'better_sqlite3.node SHA-256 does not match the official Electron prebuild.',
        `  installed: ${actualHash} (${size} bytes)`,
        `  expected:  ${expected.hash} (${expected.size} bytes) from ${expected.asset}`,
        '  Refusing to package a Node-ABI (e.g. 115) binary into the Electron app.',
      ].join('\n'),
    )
  }
  console.log(
    `OK: better_sqlite3.node matches ${expected.asset} (sha256=${actualHash.slice(0, 12)}…, ${size} bytes, Electron ABI ${EXPECTED_ELECTRON_ABI})`,
  )
}

fs.mkdirSync(runtime, { recursive: true })
run('npm', ['install', '--omit=dev'], { cwd: runtime })

const bsql = path.join(runtime, 'node_modules', 'better-sqlite3')
if (!fs.existsSync(bsql)) {
  console.error('better-sqlite3 missing after install')
  process.exit(1)
}

const bsqlPkg = JSON.parse(fs.readFileSync(path.join(bsql, 'package.json'), 'utf8'))
const electronVersion = readElectronVersion()
const abi = resolveAbi(electronVersion)

if (abi !== EXPECTED_ELECTRON_ABI) {
  console.error(
    `Electron ${electronVersion} resolves to ABI ${abi}, but this script expects ${EXPECTED_ELECTRON_ABI}. Update EXPECTED_ELECTRON_ABI if you bumped Electron.`,
  )
  process.exit(1)
}

console.log(
  `Fetching better-sqlite3@${bsqlPkg.version} for Electron ${electronVersion} (ABI ${abi}) ${PLATFORM}-${ARCH}`,
)

// Remove any Node-ABI binary left by npm install so we never ship NODE_MODULE_VERSION 115
const releaseDir = path.join(bsql, 'build', 'Release')
fs.mkdirSync(releaseDir, { recursive: true })
for (const name of ['better_sqlite3.node', 'better_sqlite3.win32-x64.node']) {
  const p = path.join(releaseDir, name)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

const prebuild = spawnSync(
  'npx',
  [
    '--yes',
    'prebuild-install',
    '--runtime',
    'electron',
    '--target',
    electronVersion,
    '--platform',
    PLATFORM,
    '--arch',
    ARCH,
    '--verbose',
  ],
  {
    cwd: bsql,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      npm_config_platform: PLATFORM,
      npm_config_arch: ARCH,
      npm_config_target: electronVersion,
      npm_config_runtime: 'electron',
      npm_config_disturl: 'https://electronjs.org/headers',
    },
  },
)

if (prebuild.status !== 0) {
  console.error(
    'prebuild-install for Electron win32 failed. Cannot package desktop without Electron ABI binding.',
  )
  process.exit(prebuild.status || 1)
}

const dest = path.join(releaseDir, 'better_sqlite3.node')
if (!fs.existsSync(dest)) {
  console.error('prebuild-install succeeded but better_sqlite3.node is missing at', dest)
  process.exit(1)
}

// Keep a clearly named copy for audits / Windows packaging
const winDest = path.join(releaseDir, 'better_sqlite3.win32-x64.node')
fs.copyFileSync(dest, winDest)

const expected = await fetchOfficialElectronPrebuild(bsqlPkg.version, abi)
assertElectronAbiBinary(dest, expected)

const meta = {
  package: 'better-sqlite3',
  version: bsqlPkg.version,
  runtime: 'electron',
  electronVersion,
  abi,
  platform: PLATFORM,
  arch: ARCH,
  asset: expected.asset,
  sha256: expected.hash,
  bytes: expected.size,
  verifiedAt: new Date().toISOString(),
}
fs.writeFileSync(path.join(releaseDir, 'better_sqlite3.abi.json'), JSON.stringify(meta, null, 2) + '\n')
console.log('Wrote ABI metadata', path.join(releaseDir, 'better_sqlite3.abi.json'))

console.log('Desktop server-runtime ready at', runtime)
