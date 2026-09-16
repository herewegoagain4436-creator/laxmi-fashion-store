# Packaging — Laxmi Fashion Wholesale Mart

## Artifacts (this machine)

Built outputs are copied to `release/`:

| File | Platform | How to run |
|------|----------|------------|
| `release/LaxmiFashion-Setup.exe` | Windows 10/11 x64 (NSIS) | Installer — **preferred for auto-update** |
| `release/LaxmiFashion-Portable.exe` | Windows 10/11 x64 | Double-click. No install needed. |
| `release/LaxmiFashion.apk` | Android | Enable **Install unknown apps**, open the APK. |

Demo login: **owner** / **owner123** (cashier: **cashier** / **cashier123**).

### Windows desktop

- Electron wraps the Vite UI + Express/SQLite API.
- **SQLite DB lives in Windows AppData** (`%APPDATA%/Laxmi Fashion Wholesale Mart/data/laxmi.db`). Updates never wipe this folder.
- Local API binds to `127.0.0.1:8787`; the window loads that URL.
- GST-inclusive receipts, four prices, and custom categories are unchanged.

Rebuild on Linux (cross-compile) or on Windows:

```bash
npm install
npm run dist:win
```

Requires Wine on Linux for the portable/NSIS step. Script `scripts/prepare-desktop-runtime.mjs` fetches the Windows `better-sqlite3` native binary.

NSIS only: `npm run dist:win:nsis -w @laxmi/desktop`  
Portable only: `npm run dist:win:portable -w @laxmi/desktop`

---

## Private auto-updates (Windows)

The GitHub repo **`herewegoagain4436-creator/laxmi-fashion-store` is private**. Releases stay private — you do **not** need (and should not) make releases or the repo public.

### How it works for the shop owner

1. Desktop app uses **electron-updater** with GitHub provider `private: true`.
2. On startup (and via **Help → Check for updates…** or **Settings → Check for updates**), it checks the latest **private** Release.
3. If a newer NSIS build is available, it downloads and prompts to **Restart now** to install. Shop SQLite data in AppData is preserved.
4. Auth requires a GitHub token with access to this private repo’s contents/releases.

### Settings fields (owner)

| Field | Where | Purpose |
|-------|--------|---------|
| **Update access token** | Settings → App updates (private) | Paste fine-grained PAT once |
| **Save update token** | same | Stores token (Electron **safeStorage** encrypted file under userData on desktop; `localStorage` on phone/web) |
| **Clear token** | same | Removes saved token |
| **Check for updates** | same (+ Help menu on desktop) | Manual check |

Advanced users can set environment variable **`GH_TOKEN`** or **`LAXMI_GH_TOKEN`** instead of pasting in Settings (never commit these).

If no token is configured, the app shows: **“Add a private update token in Settings”** (does not fail silently).

### Create a fine-grained PAT (owner)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate**.
2. Resource owner: your account / the org that owns the repo.
3. Repository access: **Only select repositories** → `laxmi-fashion-store`.
4. Permissions:
   - **Contents**: Read-only
   - **Releases**: Read-only  
   (Classic PAT: scope `repo` also works; fine-grained is safer.)
5. Generate, copy the token once.
6. On the shop PC: open the app → **Settings** → paste into **Update access token** → **Save update token**.

Do **not** commit the token to git. Do **not** put it in `.env` files that get committed.

### Publish a new private Windows release

On a machine with `gh` logged in as `herewegoagain4436-creator` (or another collaborator):

```bash
# Bumps patch version, builds NSIS + portable, creates private GitHub Release
npm run release:win

# Or set the version explicitly
VERSION=1.0.1 npm run release:win

# Also attach Android APK if present in release/
INCLUDE_APK=1 npm run release:win

# Artifacts already built — only create the GitHub Release
SKIP_BUILD=1 VERSION=1.0.1 npm run release:win
```

What the script does:

1. Bumps `version` in root + workspace `package.json` files and `apps/web/src/lib/appVersion.ts`.
2. Runs `npm run build`, desktop runtime prepare, and `electron-builder` (**nsis + portable**).
3. Copies artifacts to `release/` (Setup.exe, Portable.exe, `latest.yml`, blockmap).
4. Runs `gh release create vX.Y.Z … --repo herewegoagain4436-creator/laxmi-fashion-store` **without** `--public`.

`latest.yml` is required for electron-updater. Prefer shipping **LaxmiFashion-Setup.exe** (NSIS) on the update channel; portable is for manual copy installs.

electron-builder publish config (in `apps/desktop/package.json`):

```json
"publish": [{
  "provider": "github",
  "owner": "herewegoagain4436-creator",
  "repo": "laxmi-fashion-store",
  "private": true
}]
```

---

## Android (lightweight update check)

In **Settings → App updates (private)** on the phone/PWA:

1. Paste the same fine-grained PAT into **Update access token** (stored in this device’s localStorage).
2. Tap **Check for updates** — uses GitHub Releases API against the private repo.
3. If a newer release has `LaxmiFashion.apk`, you can **Download LaxmiFashion.apk** (authenticated download) or open the release page.

Full in-app silent APK install is out of scope for v1; version check + download is enough.

Include the APK on a release with `INCLUDE_APK=1 npm run release:win` after `npm run dist:android`, or upload the APK to the release manually with `gh release upload`.

### Android build

```bash
# Needs Android SDK + JDK 17+
export ANDROID_HOME=~/Android/Sdk
export JAVA_HOME=…   # JDK 17+
npm run dist:android
```

The phone app runs **offline-first** (IndexedDB). To sync with the shop PC:

1. Run the Windows desktop app (or `npm start` server) on the PC.
2. On the phone, open **Settings → Sync server** and enter `http://<PC-LAN-IP>:8787`.
3. Tap **Sync now**.

Cleartext HTTP to the LAN is allowed for this demo.

## Layout

```
apps/web       Vite React PWA
apps/server    Express + better-sqlite3
apps/desktop   Electron + electron-builder + electron-updater
android/       Capacitor Android project
scripts/       prepare-desktop-runtime, copy-win-artifact, build-android, release-win
release/       Built .exe / .apk (gitignored binaries)
```
