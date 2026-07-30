# Rebuild Milestones

Each milestone is self-contained and testable. We build top-down: foundation
first, then the signal/backtest core, then data, API, and finally the frontend.

- [x] **M1 — Foundation**
      Data models (`models.py`), Postgres layer + schema bootstrap
      (`database.py`), auth service (`auth_service.py`), FastAPI app with a live
      bearer gate + full `/auth/*`, and the complete ~60-endpoint surface stubbed
      and labeled. Boots and serves `/healthz` + login.

- [x] **M2 — Signal engine (Python)** ✓
      Reproduced the Ehlers Gaussian-channel math (`signals.py`: `_compute_pole`,
      `_gaussian_channel`), the Green/Grey/Red tier classifier, the Trend Scanner
      state machine, and the Pine→config parser (`pinescript_parser.py`).
      Verified against the real BTC daily fixture (7 checks pass). Wired live:
      `/signals/breakouts`, `/signals/trends`, `/signals/chart/*` (with caching),
      `/strategy/parse-pine`, and `/symbols/{bucket}`. The backtest signal
      generators (`strategy*.py` `build_signals*`) belong with the engine in M3.
      Signal endpoints return empty until data sources land in M4.

- [x] **M3 — Backtest engine (Python)** ✓
      Reproduced the verified TradingView-matching execution engine (`engine/`),
      the `build_signals*` generators (`strategy.py` / `strategy_bot4.py` /
      `strategy_bot1.py`), and `backtest/engine_adapter.py` + `backtest/runner.py`.
      Reimplemented run/results/dashboard/saved-strategy persistence over Postgres
      (column-based `backtest_results`, same sort + outlier + aggregation logic).
      Wired live: `/runs` (list/create/get/delete), `/runs/*/results`,
      `/runs/*/results/{symbol}`, `/runs/*/progress`, `/runs/*/export` (CSV) and
      `/export/xlsx` (openpyxl, decoupled from Telegram), `/dashboard/summary`,
      `/strategy/preview-top10`, and `/strategy/saved` CRUD. Golden-master
      regression test pins KPIs on all four fixtures (BTC +94.10%/11 trades,
      AAPL +17.85%/15, Gold +6.01%/9, Crude −6.32%/15). Live runs execute once
      data sources land in M4.

- [x] **M4 — Data layer** ✓
      Reproduced the verified OHLCV fetchers: `data/crypto.py` (routes through the
      `market_exchange` resolver), `data/market_exchange.py` (probes
      binance→gateio→kucoin→binanceus→kraken, caching the first reachable id to
      survive the prod 451 geo-block), `data/equities.py` (yfinance single + batch
      for stocks/metals/commodities), and `data/stock_universe.py` (dynamic
      universe). `/system/resync` now force-re-probes the source and rebuilds the
      universe. Signatures satisfy both the scanner (`limit`) and the backtest
      runner (`start_date`/`end_date`). With this in place, every `/signals/*` and
      `/runs` endpoint serves real market data in a networked environment.
      (Live fetching can't be exercised in the offline build sandbox; verified by
      reproduction + full import-graph check.)

- [ ] **M5 — Typed TS client + API codegen**
      OpenAPI spec for the Python API, Orval-generated React client + Zod types
      for the dashboard. No Express server, no Drizzle package (Python owns the
      DB). Saved-strategy types included.

- [ ] **M6 — Frontend foundation**
      React/Vite/shadcn scaffold, EN/HE i18n + RTL, Bitcoin-orange theme,
      auth login gate, layout/sidebar.

- [ ] **M7 — Frontend features + paper trading**
      Signals/Trend Scanner, runs + run-detail (live polling), strategy lab,
      explain modals, PDF export, profit engine panel, paper trading.

- [x] **M8 — Trading integrations** ✓
      Exchange service (`exchange_service.py`: Fernet-encrypted keys via SESSION_SECRET,
      pbkdf2 PIN, ccxt balances/positions/orders/close-profitable), profit engine
      (`profit_engine.py`), Telegram (`telegram_service.py`: send/test/detect/notify + Excel),
      and paper trading (`paper_trading.py`: sessions, mark-to-market, target-reached decision
      flow, history). Every `/exchange/*`, `/exchange/paper/*`, `/telegram/*`,
      `/signals/send-telegram`, and `/portfolio/activity` route is live and (where it moves
      money or reads live balances) PIN-gated. Profit `build_plan` and the paper
      pick→size→mark-to-market→close logic verified offline; live exchange/Telegram I/O
      verified by reproduction + static call-site resolution. **The Python backend is now
      feature-complete — 0 stubbed routes.** Auto-scan + scheduled-send schedulers
      (APScheduler) are the one deferred bit, landing in M9.

- [ ] **M9 — Wire-up**
      Env, DB push, run scripts, final smoke test.

## Locked decisions
- **Single Python backend.** Python/FastAPI is the only backend. The original's
  empty Express `api-server` and vestigial Drizzle DB package are dropped. The TS
  side is only a generated client + Zod types for the dashboard (type-safe API
  calls), not a second backend. (M5.)
- **Hebrew/RTL primary UI with an EN toggle** (EN/HE i18n switcher). (M6.)
