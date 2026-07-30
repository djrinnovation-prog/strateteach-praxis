# ALGO770 — Live (real‑money) checklist

Go through each on **app.strateteach.com** after a hard refresh (Cmd+Shift+R). Tick what works; tell me any that fail.

## 0. Prerequisites (Binance side — you do these)
- [ ] API key has **Enable Reading** + **Enable Spot & Margin Trading** ✓ (you set this)
- [ ] **Symbol Whitelist OFF** (or your symbols added) ✓
- [ ] Server IPs whitelisted: `18.199.127.118` and `167.233.52.116`
- [ ] (Optional) Futures: only works if your account/region allows it and the key has **Enable Futures**. Currently spot‑only.

## 1. Connect & funds
- [ ] Exchange Connect shows **Connected · BINANCE · LIVE**
- [ ] Total funds / Available (USDT) load with real numbers
- [ ] "Connected · LIVE" badge shows on Profit engine, Daily scan, Backtests

## 2. Open a position (Exchange ticket)
- [ ] Symbol picker lists **live Binance pairs** ("Pick from N live symbols")
- [ ] Size slider 1–100% + chips (10/25/50/75/Max)
- [ ] **Long (buy)** places a real spot order (after confirm) and shows the position below
- [ ] **Sell** sells your holding
- [ ] Order errors show a clear reason (not a blank/"—")

## 3. Positions & P&L
- [ ] Each position shows its own **P&L** and **%**
- [ ] **Tap a position** → expands to show qty, avg cost, price, value, P&L
- [ ] **Total P&L = sum of positions' P&L**; Total value = cash + holdings
- [ ] Main **Dashboard** (/overview) shows the live funds card + Total P&L
- [ ] Home live card shows Total / Available / In positions / Total P&L

## 4. Close
- [ ] Per‑position **Close (X)** actually sells that coin (one confirm) — no second trip
- [ ] **Close all → USDT** on: Exchange ticket, Profit engine dashboard (hero), Profits drawer, daily‑target alert
- [ ] After closing, the position **disappears** (sub‑$1 dust is hidden)
- [ ] Close reports "Closed N · X failed" if any fail

## 5. Profit Engine — live
- [ ] Live screen reads like demo at top (hero, 4 cards, Top 10, Change mode)
- [ ] **New run (live)**: choose **1–20 positions** + **invest amount** → **Apply & build**
- [ ] Plan list is **scrollable**, and the New‑run card has a **Minimize** toggle
- [ ] Only **tradable** coins appear in the plan (no "unknown symbol")
- [ ] When **all capital is invested**, "open more" (New run / Approve all / Place) is **disabled** with a "close to free funds" note

## 6. Automation (opt‑in)
- [ ] **Auto‑pilot** toggle auto‑builds picks; **Approve all (N)** places them (one confirm)
- [ ] Failed picks show with reason + **Retry failed** / **Reload**
- [ ] **Daily target** (% or $): at target you get an alert + one‑tap close (never auto‑sells without your tap)

## 7. Drawers (right rail)
- [ ] **Profits** drawer in live mode = your real positions + P&L + Close all → USDT
- [ ] **Activity** drawer defaults to your mode; **live activity is visible** (not locked)

## 8. Admin / alerts
- [ ] My Profile → **My Telegram (admin alerts)**: connect your own bot token + chat ID; Send test
- [ ] You receive your own target‑hit / promote alerts (only your data)

## 9. Safety (should always hold)
- [ ] No order/close ever fires **without your tap/confirm**
- [ ] Withdraw needs typed "WITHDRAW" + confirm + whitelisted address (+ PIN if you set one)

---

### Known limits (by design / data)
- **Futures** depends on Binance enabling it for your account/region — spot is the working path now.
- **Total P&L** is computed from orders placed **in the app**; coins bought outside the app show "no cost basis / P&L —" until traded in‑app.
- **Month/Year P&L tabs** not built yet (all‑time + today only) — needs daily snapshots (can add).
- **"Dashboard buttons active"** — tell me which buttons; not yet wired.
