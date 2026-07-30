# Deploying 770 Trend Diamonds on your own domain (not Replit hosting)

This runs the whole app — the API + a PostgreSQL database + automatic HTTPS — with
one command, on any server you control, reachable at the domain you bought through
Replit. You only manage **DNS** at Replit; the app itself runs on your server.

> You can hand this whole folder to Cowork and say *"follow DEPLOY.md and deploy this
> to my server,"* or do the steps yourself. Either way the commands are below.

## What you need
- A small **VPS** (virtual server) with a public IP and Ubuntu — e.g. DigitalOcean,
  Hetzner, or Linode. The smallest paid tier is plenty to start.
- **Docker** installed on it. On a fresh Ubuntu box:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- Your domain, bought via Replit (you'll point it here in step 4).

## Step 1 — Put the project on the server
Copy this folder to the server (via `scp`, `git clone`, or Cowork). Then `cd` into it.

## Step 2 — Create your settings file
```bash
cp .env.example .env
nano .env          # fill in the values
```
Set at least:
- `DOMAIN` — the domain/subdomain you'll use (e.g. `app.yourdomain.com`).
- `SESSION_SECRET` — generate with `openssl rand -hex 32`. (Required for exchange features; it encrypts your stored API keys.)
- `ADMIN_DEFAULT_PASSWORD` — your admin password (login is `admin` / this).
- `POSTGRES_PASSWORD` — any long random string.

## Step 3 — Open the firewall
Allow web traffic so HTTPS can be issued and served:
```bash
sudo ufw allow 80 && sudo ufw allow 443
```

## Step 4 — Point your domain at the server (DNS at Replit)
In Replit, open **Publishing → Domains** for your domain and add an **A record**:
- **Host/Name**: `@` for the bare domain, or your subdomain (e.g. `app`).
- **Value/Points to**: your server's public IP address.

Important: if this domain was previously pointing at a Replit deployment, **delete those
old Replit A/TXT records first** so they don't conflict. DNS can take a few minutes (up to
a couple hours) to propagate. (Replit's DNS supports A, TXT, and MX records — an A record
to your server's IP is exactly what you need.)

## Step 5 — Launch
```bash
docker compose up -d --build
```
This builds the API image, starts PostgreSQL, starts the API, and starts Caddy — which
automatically obtains a real HTTPS certificate for your domain once DNS resolves to the
server. First boot also creates the database tables and the seed `admin` user.

## Step 6 — Verify
- Visit `https://YOURDOMAIN/healthz` → you should see `{"status":"ok"}`.
- Visit `https://YOURDOMAIN/docs` → the interactive API. Log in with `admin` / your password.
- Run the **smoke-test console** in *Live* mode pointed at `https://YOURDOMAIN` to walk the
  full sequence (health → login → signals → backtest → results → dashboard) end to end.

## Updating later
```bash
git pull            # or re-copy the folder
docker compose up -d --build
```
Your data lives in a Docker volume (`pgdata`) and survives rebuilds.

## Notes
- **Exchange & Telegram** features make outbound calls (ccxt, Telegram API) — that works
  fine from a normal VPS. Crypto data uses a fallback across exchanges to dodge the
  Binance 451 geo-block; if crypto looks empty, `POST /system/resync` re-probes the source.
- **No Docker?** You can also run it directly: `pip install -r requirements.txt`, set the
  same environment variables, then `cd python-backend && ./start.sh`, and put any reverse
  proxy (Caddy/Nginx) in front for HTTPS.
- **PaaS instead of a VPS?** Render/Railway/Fly.io can run the `Dockerfile` too, but they
  usually give you a CNAME target rather than an IP. Replit's domain DNS points via an A
  record (IP), so a VPS is the simplest match. If you prefer a PaaS, move the domain's DNS
  to Cloudflare (which supports CNAME-at-apex) and point it at the PaaS target.
- The React dashboard isn't built yet (that's the next milestones). When it is, it'll be
  served alongside this same backend — this deploy setup won't change much.
