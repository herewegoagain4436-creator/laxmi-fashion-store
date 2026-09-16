# Cloud sync — Laxmi Fashion

Keep **PC (Windows exe)** and **Android phone** in sync over the **internet** (not only same Wi‑Fi). Each device still works **offline**; they sync when online.

## What you need

1. A **Cloud URL** — HTTPS address of the shop sync server (example: `https://laxmi-fashion-sync.fly.dev`)
2. A **Sync token** — long secret shared by all shop devices (never post publicly)

Your setup person generates the token and URL once, then you paste them on every device.

## On the Windows PC (exe)

1. Open **Laxmi Fashion** → sign in as **owner**.
2. Go to **Settings**.
3. Under **Stock sync (PC ↔ phone)**:
   - Choose **Cloud**
   - Paste **Cloud URL** (HTTPS)
   - Paste **Sync token**
   - Tap **Save sync settings**
4. Tap **Check connection** — should say cloud is reachable.
5. Tap **Sync now** (or use the cloud badge in the header).

## On the Android phone (APK)

1. Install / open the app → sign in (`owner` / `owner123` or your password).
2. **Settings** → **Stock sync**:
   - Choose **Cloud**
   - Same **Cloud URL** and **Sync token** as the PC
   - **Save sync settings** → **Check connection** → **Sync now**

Use the **same** URL and token on every device for this shop.

## Sync modes

| Mode | When to use |
|------|-------------|
| **Offline only** | One device; no sharing |
| **LAN PC** | Phone + PC on the **same Wi‑Fi**; phone uses PC address like `http://192.168.1.10:8787` |
| **Cloud** | Different networks / mobile data — **recommended** for shop + home |

## How it works (short)

- Sales, purchases, stock edits save on the device first (IndexedDB).
- When online in **Cloud** or **LAN** mode, the app pushes pending changes and pulls the latest snapshot from the server.
- The server checks the **sync token** (`Authorization: Bearer …` or header `X-Laxmi-Token`).

## Deploy the sync server (for setup / IT)

Repo root includes:

- `Dockerfile` — production image (Express + SQLite + web UI)
- `fly.toml` — Fly.io
- `render.yaml` — Render
- `railway.toml` — Railway
- `scripts/run-cloud-local.sh` — local listen on `0.0.0.0`
- `scripts/cloudflare-tunnel.sh` — **temporary** HTTPS via Cloudflare quick tunnel

### Required environment

| Variable | Purpose |
|----------|---------|
| `LAXMI_SYNC_TOKEN` | Shared store secret (required in cloud) |
| `LAXMI_SECRET` | Signs login JWTs (set a random value in production) |
| `LAXMI_DATA_DIR` | SQLite directory (default `/data` in Docker) |
| `PORT` / `HOST` | Default `8787` / `0.0.0.0` |

Health check: `GET /api/health` (no token).

### Fly.io (example)

```bash
fly auth login
fly apps create laxmi-fashion-sync
fly volumes create laxmi_data --region sin --size 1
fly secrets set LAXMI_SYNC_TOKEN="$(openssl rand -hex 24)" LAXMI_SECRET="$(openssl rand -hex 32)"
fly deploy
```

Then give the shop owner: `https://<app>.fly.dev` + the sync token value.

### Cloudflare quick tunnel (temporary only)

If no cloud host is available yet, you can run the server on a always-on PC/box and:

```bash
export LAXMI_SYNC_TOKEN=...
export LAXMI_ALLOW_LOCALHOST_NO_TOKEN=0   # required: tunnel connects via 127.0.0.1
npm run build && ./scripts/run-cloud-local.sh   # terminal 1
./scripts/cloudflare-tunnel.sh                  # terminal 2 → prints https://….trycloudflare.com
```

**Limitations:** URL changes when the tunnel restarts; the machine must stay online; fine for a trial, not a permanent shop URL. Prefer Fly/Render/Railway for a stable HTTPS hostname.

## Security notes

- Never commit real tokens to git.
- Rotate the token by changing `LAXMI_SYNC_TOKEN` on the server and updating every device.
- Local desktop without `LAXMI_SYNC_TOKEN` still works for single-PC use (token not required).
