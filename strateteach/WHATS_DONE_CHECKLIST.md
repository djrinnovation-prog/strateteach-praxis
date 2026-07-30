# ALGO770 / Strateteach — What's Done (verify on app.strateteach.com)

_Updated June 10, 2026. Hard-reload the site first: **Cmd+Shift+R**._

The deploy was frozen for a while by a single missing `</div>` in the Backtests
screen — that broke every build, so nothing shipped. **That is fixed and live now.**
Everything below should be visible.

---

## 1. Profit engine (the big one)

- [ ] **Demo or Live choice first** — opening Profit asks you to pick a mode before anything else.
- [ ] **Demo needs no password** — pick Demo, you're straight in (no PIN).
- [ ] **"Change mode"** button lets you switch Demo ↔ Live.
- [ ] **Invest amount field** — set a $ amount and the engine builds a plan even with no balance connected.
- [ ] **Target by $ or by %** toggle — choose a dollar profit target or a % per position.
- [ ] **Top-N picks** — set how many top assets the engine deploys into (up to 50).
- [ ] **Build plan** shows the recommended picks with expected profit.
- [ ] **Running demo session dashboard (NEW)** — in Demo mode, scroll down: start a
      virtual session (capital, positions, take-profit) and watch **live P&L update
      every 8s**, with close / keep-going / stop / delete per session.
- [ ] **Harvest profits** button appears in **Live** mode only.

## 2. University + info buttons

- [ ] **"i" info button** on each screen's title — click for a plain-language explanation.
- [ ] **University / Explanations screen** (home orb + nav) — full end-user guide:
      step-by-step, how strategies are built, what the profit engine is, glossary,
      Hebrew + English.

## 3. Export on every screen

- [ ] **Excel (CSV)** button — downloads the screen's data (opens in Excel, Hebrew-safe).
- [ ] **PDF** button — clean branded print-to-PDF.
- [ ] **"Email this data"** button — **admin only**, on every data screen.

## 4. Backtests

- [ ] **Start / end date** inputs on the launcher.
- [ ] **Add a strategy by pasting Pine script** — "check engine" parses it fast and adds it.

## 5. Admin dashboard

- [ ] **Connected users, live** — see who's online now (green dot = active < 5 min) and
      how long they've been connected; refreshes every 15s.
- [ ] **Audit log** — logins, user changes, sensitive actions.

## 6. Accounts, roles & limits

- [ ] **Login lockout** after repeated failed attempts.
- [ ] **User limits** — 50 users total; **you (admin) can add unlimited**; other "admin"
      users can add **5 each**.
- [ ] **Per-user protection code** — backend is live; each user sets their own code in
      Settings (not one shared password). _UI card still being finished — see below._

## 7. Privacy / legal / safety

- [ ] **Risk acknowledgment** shown once after login.
- [ ] **Your data** card in Settings — export your data / delete your account (GDPR).
- [ ] **Terms of Service + Risk Disclaimer** drafts in `/legal` (need a lawyer's review;
      bracketed placeholders to fill).

## 8. Operations (server-side, not a screen)

- [ ] Nightly **database backups** + restore script.
- [ ] **Rate limiting** on auth.
- [ ] **Sentry** error monitoring (set `SENTRY_DSN` to switch on).
- [ ] API keys stay **non-custodial** — browser-only, never stored on the server.

---

## Needs YOU before it works

- **Email** — built but dormant. It turns on once you verify your domain in Resend and
  paste the API key into the server `.env` (`SMTP_*`). I'll guide you; I won't enter the
  key myself.

## Still on my list (next)

1. Per-user protection-code **card in Settings** (backend already done).
2. Full original profit flow polish: scan → "approve recommendations" → open session.
3. Backtest **batch-fetch** speed pass (verify on server — it's the risky one).
