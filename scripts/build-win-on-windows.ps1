# Run on a Windows machine (PowerShell) to produce LaxmiFashion-Portable.exe
Set-Location $PSScriptRoot\..
npm install
npm run build
npm run build:desktop-runtime
npm run dist:win -w @laxmi/desktop
node scripts/copy-win-artifact.mjs
Write-Host "Done. See release\LaxmiFashion-Portable.exe"
