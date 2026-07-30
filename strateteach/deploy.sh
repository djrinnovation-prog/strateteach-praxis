#!/usr/bin/env bash
# One-shot deploy for 770 Trend Diamonds on a VPS (Docker + Caddy auto-HTTPS).
# Run from the project root on your server:  ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 770 Trend Diamonds — deploy"

# 1. Docker present?
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Installing (needs sudo)…"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' (v2) not available. Install Docker Compose plugin and retry." >&2
  exit 1
fi

# 2. .env present and DOMAIN set?
if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing. Copy your filled .env into this folder first." >&2
  exit 1
fi
DOMAIN_LINE="$(grep -E '^DOMAIN=' .env || true)"
if [[ -z "$DOMAIN_LINE" || "$DOMAIN_LINE" == *"CHANGE-ME"* ]]; then
  echo "ERROR: Set a real DOMAIN in .env (currently unset or placeholder)." >&2
  exit 1
fi
DOMAIN="${DOMAIN_LINE#DOMAIN=}"
echo "==> Domain: $DOMAIN"

# 3. Firewall (best-effort; ignore if ufw absent)
if command -v ufw >/dev/null 2>&1; then
  echo "==> Opening ports 80/443…"
  sudo ufw allow 80/tcp  >/dev/null 2>&1 || true
  sudo ufw allow 443/tcp >/dev/null 2>&1 || true
fi

# 4. DNS sanity check (warn only)
SERVER_IP="$(curl -fsS https://api.ipify.org || echo '')"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [[ -n "$SERVER_IP" && -n "$RESOLVED" && "$SERVER_IP" != "$RESOLVED" ]]; then
  echo "WARNING: $DOMAIN resolves to $RESOLVED but this server is $SERVER_IP."
  echo "         HTTPS won't be issued until the DNS A record points here. Continuing…"
fi

# 5. Build + launch
echo "==> Building and starting the stack…"
docker compose up -d --build

# 6. Wait for health
echo "==> Waiting for the API to become healthy…"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:5000/healthz" >/dev/null 2>&1 \
     || docker compose exec -T backend curl -fsS "http://localhost:5000/healthz" >/dev/null 2>&1; then
    echo "==> API is up."
    break
  fi
  sleep 2
done

echo ""
echo "Done. Once DNS has propagated, check:"
echo "  https://$DOMAIN/healthz   -> {\"status\":\"ok\"}"
echo "  https://$DOMAIN/docs      -> interactive API (login: admin / your ADMIN_DEFAULT_PASSWORD)"
echo ""
echo "Logs:    docker compose logs -f"
echo "Update:  git pull && docker compose up -d --build"
