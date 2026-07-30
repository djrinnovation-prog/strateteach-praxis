#!/usr/bin/env bash
# One-shot server setup for 770 Trend Diamonds on a fresh Ubuntu box.
# Run on the server as root:
#   curl -fsSL https://raw.githubusercontent.com/tanya770algo/algo770-strateteach/main/server-setup.sh | bash
set -euo pipefail

REPO="https://github.com/tanya770algo/algo770-strateteach.git"
DIR="/opt/algo770"
DOMAIN="app.strateteach.com"

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh
command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y git; }

echo "==> Fetching the app..."
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  ADMIN_PW="$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9' | cut -c1-14)"
  cat > .env <<EOF
DOMAIN=$DOMAIN
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_DEFAULT_PASSWORD=$ADMIN_PW
POSTGRES_USER=algo770
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=algo770
EOF
  printf 'admin / %s\n' "$ADMIN_PW" > /root/algo770-admin.txt
  echo "==> Admin login -> admin / $ADMIN_PW  (also saved to /root/algo770-admin.txt)"
fi

echo "==> Opening firewall (22/80/443)..."
ufw allow 22/tcp  || true
ufw allow 80/tcp  || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> Building & starting the stack (a few minutes the first time)..."
docker compose up -d --build

echo "==> Enabling 5-minute auto-deploy from GitHub..."
cat > /etc/cron.d/algo770-autodeploy <<'CRON'
*/5 * * * * root cd /opt/algo770 && /usr/bin/git pull --ff-only && /usr/bin/docker compose up -d --build >> /var/log/algo770-deploy.log 2>&1
CRON

echo ""
echo "==> DONE. It will be live at https://$DOMAIN within a few minutes (once HTTPS is issued)."
echo "==> Your admin password is in /root/algo770-admin.txt"
