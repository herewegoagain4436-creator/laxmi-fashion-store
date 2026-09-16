# Packaging — Laxmi Fashion Wholesale Mart

## Artifacts (this machine)

Built outputs are copied to `release/`:

| File | Platform | How to run |
|------|----------|------------|
| `release/LaxmiFashion-Portable.exe` | Windows 10/11 x64 | Double-click. No Node/npm install needed. |
| `release/LaxmiFashion.apk` | Android | Enable **Install unknown apps**, open the APK. |

Demo login: **owner** / **owner123** (cashier: **cashier** / **cashier123**).

### Windows desktop

- Electron wraps the Vite UI + Express/SQLite API.
- SQLite DB lives in Windows AppData (`%APPDATA%/Laxmi Fashion Wholesale Mart/data/laxmi.db`).
- Local API binds to `127.0.0.1:8787`; the window loads that URL.
- GST-inclusive receipts, four prices, and custom categories are unchanged.

Rebuild on Linux (cross-compile) or on Windows:

```bash
npm install
npm run dist:win
```

Requires Wine on Linux for the portable/NSIS step. Script `scripts/prepare-desktop-runtime.mjs` fetches the Windows `better-sqlite3` native binary.

On a Windows PC you can also run:

```bash
npm run build
npm run build:desktop-runtime
npm run dist:win -w @laxmi/desktop
```

NSIS installer (optional): `npm run dist:win:nsis -w @laxmi/desktop`

### Android (Capacitor)

Debug APK (unsigned debug keystore — install via “unknown sources”):

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
apps/desktop   Electron + electron-builder
android/       Capacitor Android project
scripts/       prepare-desktop-runtime, copy-win-artifact, build-android
release/       Built .exe / .apk (gitignored binaries)
```
