# Laxmi Fashion Wholesale Mart

Local-first store management PWA for the shop counter (PC) and owner/cashier phones. Prices are GST-inclusive. **Sale receipts never show GST %, CGST/SGST, or a GST total.**

## Stack

- Web: Vite + React + TypeScript + Tailwind CSS + Dexie (IndexedDB)
- Server: Express + better-sqlite3 (sync API)
- PWA: installable, offline shell + local data, sync when online

## Run (development)

From the repo root:

```bash
npm install
npm run dev
```

- Web (PWA): http://localhost:5173
- API: http://127.0.0.1:8787

Vite proxies `/api` to the server. Keep both processes running (the `npm run dev` script starts them together).

### Run separately

```bash
npm install
npm run dev:server
npm run dev:web
```

## Run (production-style, one port)

```bash
npm install
npm run build
npm start
```

Then open http://localhost:8787 (server serves the built web app and `/api`).

## Demo login

| Role    | Username | Password   | Access                                      |
|---------|----------|------------|---------------------------------------------|
| Owner   | `owner`  | `owner123` | Full (stock, purchase, reports, settings)   |
| Cashier | `cashier`| `cashier123` | POS sales, view stock, returns            |

## Demo flow

1. Sign in as **owner**.
2. **Purchase** — New purchase from Rajasthan Textiles, add Cotton Kurti (size L) and Cotton Than (metres). Save. Stock increases.
3. Open **POS** — sell Cotton Kurti (tap size chip) + Cotton Than (enter length e.g. `1.4` m). Optional discount. Pay Cash / UPI / Card / Split.
4. Complete sale — receipt shows shop name, bill no, datetime, item, size, qty/length, rate, line total, grand total, payment. **No GST lines.** Use **Print / PDF**.
5. Check **Stock** — quantities dropped. **Reports** — today sales, cash vs UPI, low stock.

## Product types

1. **Garment** — sold by piece; **size required**; no colour. Stock per size. Chips: S M L XL XXL Free size + custom (32, 34, 36…).
2. **Saree** — sold by piece; no size, no colour.
3. **Than / fabric** — stock in metres; bill enters length in m or cm (e.g. 1.4 m, 80 cm).

## Sync

Badge in the header: **Synced** / **Pending** / **Offline**. Sales use UUID ids (idempotent on the server). Writes go to IndexedDB first, then sync to SQLite.

## Seed data

On first server start: owner + cashier, store profile, sample garments (with sizes), sarees, fabrics, supplier **Rajasthan Textiles**. The browser seeds the same catalog for offline-first use.

SQLite file: `apps/server/data/laxmi.db` (gitignored). Delete it to re-seed.

## Layout

```
apps/web      PWA client
apps/server   Express + SQLite API
```

## Desktop (Windows) & Android

See [PACKAGING.md](./PACKAGING.md) for full details — including **private** GitHub auto-updates (no public releases).

Shop owner: Settings → **Update access token** → **Save update token** → **Check for updates**.  
Publish: `npm run release:win` (uses `gh` on a private Release).

```bash
# Windows portable .exe → release/LaxmiFashion-Portable.exe
npm run dist:win

# Android debug APK → release/LaxmiFashion.apk
npm run dist:android
```

- **Windows:** double-click `LaxmiFashion-Portable.exe`. Data in AppData. Login `owner` / `owner123`.
- **Android:** install `LaxmiFashion.apk` (debug build; allow unknown sources). Offline-first; set sync server URL in Settings to reach the shop PC.
