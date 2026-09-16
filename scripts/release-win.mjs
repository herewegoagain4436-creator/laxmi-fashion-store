#!/usr/bin/env node
/**
 * Private Windows release for Laxmi Fashion.
 *
 * - Bumps version (or uses VERSION=x.y.z)
 * - Builds NSIS + portable via electron-builder (emits latest.yml for electron-updater)
 * - Creates a **private** GitHub Release (repo is private; do NOT use --public)
 * - Attaches Setup.exe, Portable.exe, latest.yml, blockmap, and optional APK
 *
 * Requires: gh authenticated as a repo collaborator (herewegoagain4436-creator).
 *
 * Usage:
 *   npm run release:win
 *   VERSION=1.0.1 npm run release:win
 *   SKIP_BUILD=1 npm run release:win   # only publish existing release/ artifacts
 *   INCLUDE_APK=1 npm run release:win
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OWNER_REPO = 'herewegoagain4436-creator/laxmi-fashion-store'
const PKG_PATHS = [
  'package.json',
  'apps/desktop/package.json',
  'apps/web/package.json',
  'apps/server/package.json',
]

function run(cmd, args, opts = {}) {
  console.log('>', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, cwd: root, ...opts })
  if (r.status !== 0) process.exit(r.status || 1)
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
}

function writeJson(rel, data) {
  fs.writeFileSync(path.join(root, rel), JSON.stringify(data, null, 2) + '\n')
}

function parseVersion(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!m) throw new Error(`Invalid semver: ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: `${m[1]}.${m[2]}.${m[3]}` }
}

function bumpPatch(v) {
  const p = parseVersion(v)
  return `${p.major}.${p.minor}.${p.patch + 1}`
}

function setAllVersions(version) {
  for (const rel of PKG_PATHS) {
    const full = path.join(root, rel)
    if (!fs.existsSync(full)) continue
    const j = readJson(rel)
    j.version = version
    writeJson(rel, j)
    console.log(`version ${version} → ${rel}`)
  }
  // Keep web constant in sync for Android version check UI
  const verFile = path.join(root, 'apps/web/src/lib/appVersion.ts')
  fs.mkdirSync(path.dirname(verFile), { recursive: true })
  fs.writeFileSync(
    verFile,
    `/** Bumped by scripts/release-win.mjs — do not edit by hand for releases. */\nexport const APP_VERSION = '${version}'\n`,
  )
  console.log(`version ${version} → apps/web/src/lib/appVersion.ts`)
}

function listReleaseAssets(version) {
  const outDir = path.join(root, 'apps/desktop/release-build')
  const releaseDir = path.join(root, 'release')
  fs.mkdirSync(releaseDir, { recursive: true })

  const wanted = []
  const candidates = [
    path.join(outDir, 'LaxmiFashion-Setup.exe'),
    path.join(outDir, 'LaxmiFashion-Portable.exe'),
    path.join(outDir, 'latest.yml'),
    path.join(outDir, 'LaxmiFashion-Setup.exe.blockmap'),
  ]

  // electron-builder may name with version
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir)) {
      const full = path.join(outDir, f)
      if (/\.(exe|yml|yaml|blockmap)$/i.test(f) && fs.statSync(full).isFile()) {
        if (!candidates.includes(full)) candidates.push(full)
      }
    }
  }

  const seen = new Set()
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue
    const base = path.basename(src)
    if (seen.has(base)) continue
    seen.add(base)
    const dest = path.join(releaseDir, base)
    fs.copyFileSync(src, dest)
    wanted.push(dest)
    console.log('Prepared', dest)
  }

  if (process.env.INCLUDE_APK === '1') {
    const apk = path.join(releaseDir, 'LaxmiFashion.apk')
    if (fs.existsSync(apk)) {
      wanted.push(apk)
      console.log('Including APK', apk)
    } else {
      console.warn('INCLUDE_APK=1 but release/LaxmiFashion.apk missing — skip')
    }
  }

  // Prefer clear names for updater
  const hasLatest = wanted.some((p) => path.basename(p) === 'latest.yml')
  const hasSetup = wanted.some((p) => /Setup\.exe$/i.test(p) || /LaxmiFashion-Setup/i.test(path.basename(p)))
  if (!hasLatest) {
    console.warn(
      'WARNING: latest.yml not found. electron-updater needs it. Build with electron-builder nsis target.',
    )
  }
  if (!hasSetup) {
    console.warn('WARNING: NSIS Setup.exe not found — auto-update installs work best with NSIS.')
  }

  if (!wanted.length) {
    console.error('No release artifacts found under apps/desktop/release-build or release/')
    process.exit(1)
  }
  return wanted
}

function main() {
  const current = readJson('apps/desktop/package.json').version
  const version = process.env.VERSION ? parseVersion(process.env.VERSION).raw : bumpPatch(current)
  const tag = `v${version}`

  console.log(`\n=== Laxmi Fashion private Windows release ${tag} ===\n`)
  console.log(`Repo: ${OWNER_REPO} (private releases — never --public)\n`)

  setAllVersions(version)

  if (process.env.SKIP_BUILD !== '1') {
    run('npm', ['run', 'build'])
    run('npm', ['run', 'build:desktop-runtime'])
    run('npm', ['run', 'dist:win', '-w', '@laxmi/desktop'])
    run('node', ['scripts/copy-win-artifact.mjs'])
  } else {
    console.log('SKIP_BUILD=1 — using existing artifacts')
  }

  const assets = listReleaseAssets(version)

  // Ensure gh is available
  const ghCheck = spawnSync('gh', ['auth', 'status'], { cwd: root, encoding: 'utf8' })
  if (ghCheck.status !== 0) {
    console.error('gh is not authenticated. Run: gh auth login')
    process.exit(1)
  }

  // Fail if release already exists
  const exists = spawnSync('gh', ['release', 'view', tag, '--repo', OWNER_REPO], {
    cwd: root,
    encoding: 'utf8',
  })
  if (exists.status === 0) {
    console.error(`Release ${tag} already exists. Bump VERSION or delete the release first.`)
    process.exit(1)
  }

  const notes = [
    `Laxmi Fashion Wholesale Mart ${tag}`,
    '',
    'Private release — collaborators only.',
    '',
    '- Windows NSIS installer: LaxmiFashion-Setup.exe (auto-update channel)',
    '- Windows portable: LaxmiFashion-Portable.exe',
    '- SQLite DB stays in AppData userData across updates',
    '',
    'Shop owner: paste a fine-grained PAT in Settings → Update access token.',
  ].join('\n')

  const args = [
    'release',
    'create',
    tag,
    ...assets,
    '--repo',
    OWNER_REPO,
    '--title',
    `Laxmi Fashion ${tag}`,
    '--notes',
    notes,
    // Do NOT pass --public. Private repo releases stay private.
  ]

  run('gh', args)

  console.log(`\nDone. Private release ${tag} published on ${OWNER_REPO}`)
  console.log('Desktop apps with a valid update token will see this via electron-updater.\n')
}

main()
