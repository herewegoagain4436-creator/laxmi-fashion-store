import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'release')
fs.mkdirSync(release, { recursive: true })

function run(cmd, args, opts = {}) {
  console.log('>', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
  if (r.status !== 0) process.exit(r.status || 1)
}

const sdkRoot =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.HOME || '/home/box', 'Android', 'Sdk')

process.env.ANDROID_HOME = sdkRoot
process.env.ANDROID_SDK_ROOT = sdkRoot
process.env.PATH = `${path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin')}:${path.join(sdkRoot, 'platform-tools')}:${process.env.PATH}`

const androidDir = path.join(root, 'android')
if (!fs.existsSync(androidDir)) {
  run('npx', ['cap', 'add', 'android'])
} else {
  run('npx', ['cap', 'sync', 'android'])
}

const gradlew = path.join(androidDir, 'gradlew')
if (!fs.existsSync(gradlew)) {
  console.error('gradlew missing after cap add')
  process.exit(1)
}
fs.chmodSync(gradlew, 0o755)

run(gradlew, ['assembleDebug', '--no-daemon'], {
  cwd: androidDir,
  env: { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot },
})

const apkSrc = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk',
)
if (!fs.existsSync(apkSrc)) {
  console.error('APK not found at', apkSrc)
  process.exit(1)
}

const apkDest = path.join(release, 'LaxmiFashion.apk')
fs.copyFileSync(apkSrc, apkDest)
const st = fs.statSync(apkDest)
console.log(`APK ready: ${apkDest} (${(st.size / 1024 / 1024).toFixed(2)} MB)`)
console.log('Install: enable Unknown sources / Install unknown apps, then open the APK.')
console.log('Demo login: owner / owner123 (offline IndexedDB; set sync server in Settings for PC sync).')
