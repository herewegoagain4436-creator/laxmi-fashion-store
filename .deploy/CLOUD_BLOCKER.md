# Cloud sync deploy blocker (v1.3.0)

## Status
**Not live.** `flyctl` is installed but **not authenticated** (`fly auth whoami` → no access token).
Railway / Render CLIs are not logged in either. No stable public URL was created (do not invent one).

## What the parent agent should ask the user for
One of:

1. **Fly.io** (preferred — `fly.toml` + volume ready)
   - Run on a machine with browser: `fly auth login`
   - Or provide a Fly API token: `FLY_API_TOKEN` / `fly tokens create`
   - Then: `fly apps create laxmi-fashion-sync` (if needed), `fly volumes create laxmi_data --region sin --size 1`,  
     `fly secrets set LAXMI_SYNC_TOKEN=… LAXMI_SECRET=…`, `fly deploy`

2. **Railway** — `railway login` then `railway up` (see `railway.toml`)

3. **Render** — connect the GitHub repo and apply `render.yaml`; set `LAXMI_SYNC_TOKEN` in dashboard

## Env required for any host
- `LAXMI_SYNC_TOKEN` — shared device secret
- `LAXMI_SECRET` — JWT signing secret
- Persistent volume on `/data`

## App behaviour without cloud
Cloud sync **mode + token fields** remain in Settings. Devices work offline / LAN. When a host URL exists, paste it + token on every device.

## Temporary HTTPS (not stable)
`scripts/cloudflare-tunnel.sh` can expose a local server briefly — not a production shop URL.
