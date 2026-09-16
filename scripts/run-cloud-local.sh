#!/usr/bin/env bash
# Run the sync server locally as if in cloud (0.0.0.0 + token).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8787}"
export LAXMI_DATA_DIR="${LAXMI_DATA_DIR:-$ROOT/apps/server/data}"
export LAXMI_WEB_DIST="${LAXMI_WEB_DIST:-$ROOT/apps/web/dist}"

if [[ -z "${LAXMI_SYNC_TOKEN:-}" ]]; then
  echo "Generate a token:  openssl rand -hex 24"
  echo "Then:  export LAXMI_SYNC_TOKEN=..."
  exit 1
fi

if [[ ! -f apps/server/dist/index.js ]]; then
  npm run build
fi

echo "Listening on http://${HOST}:${PORT}  (token required)"
exec node apps/server/dist/index.js
