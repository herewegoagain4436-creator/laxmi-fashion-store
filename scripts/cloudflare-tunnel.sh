#!/usr/bin/env bash
# Ephemeral HTTPS via Cloudflare quick tunnel (no CF account).
# Limitations: URL changes on restart; not for permanent shop use; box must stay online.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"
BIN="${CLOUDFLARED_BIN:-cloudflared}"

if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "Installing cloudflared to $ROOT/.tools/cloudflared ..."
  mkdir -p "$ROOT/.tools"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) ASSET="cloudflared-linux-amd64" ;;
    aarch64|arm64) ASSET="cloudflared-linux-arm64" ;;
    *) echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/${ASSET}" -o "$ROOT/.tools/cloudflared"
  chmod +x "$ROOT/.tools/cloudflared"
  BIN="$ROOT/.tools/cloudflared"
fi

echo "Tunneling http://127.0.0.1:${PORT} → trycloudflare.com (ephemeral)"
exec "$BIN" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate
