# Release artifacts

Build locally (binaries are gitignored):

```bash
npm run dist:win        # → LaxmiFashion-Setup.exe + LaxmiFashion-Portable.exe (+ latest.yml)
npm run dist:android    # → LaxmiFashion.apk
npm run release:win     # bump version, build, create **private** GitHub Release
```

| Artifact | Run |
|----------|-----|
| `LaxmiFashion-Setup.exe` | NSIS installer (auto-update channel) |
| `LaxmiFashion-Portable.exe` | Double-click on Windows |
| `LaxmiFashion.apk` | Install on Android (debug; unknown sources) |

Login: `owner` / `owner123`

Private updates: see `PACKAGING.md`. Never commit tokens.
