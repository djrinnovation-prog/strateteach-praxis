# AGENTS.md — brief for Claude Cowork / agentic editors

You are working on **algo770-strateteach** ("770 Trend Diamonds"), a clean-room
rebuild of an existing multi-asset breakout scanner + backtester. Read this
before changing anything.

## What the app is
Daily breakout signal scanner over crypto / stocks / metals / commodities, built
on the Ehlers Gaussian-channel **BOT(8C)-770** strategy. Around the scanner:
a TradingView-matching backtester, paper trading, semi-automatic exchange trading
(ccxt, PIN-gated), a Profit Engine, Telegram delivery, and a Hebrew/RTL dashboard.

## Architecture (faithful to the original)
- `python-backend/` — **FastAPI** app; owns ALL real logic and talks to Postgres
  directly via psycopg 3. This is the API. Entry: `app/main.py`, an application
  factory (run with `uvicorn app.main:app --port 5000`).
- `lib/` — shared TS packages (OpenAPI spec, generated client + Zod types, Drizzle
  types). Added in Milestone 5.
- `artifacts/dashboard/` — React + Vite + shadcn/ui dashboard. Added in M6.
- State lives in **PostgreSQL** (`DATABASE_URL`). The whole API is bearer-gated;
  only `/healthz` + `/auth/login` are public. Money-moving `/exchange/*` routes
  are additionally PIN-gated (`X-Exchange-Pin`).

### Backend package layout (`python-backend/app/`)
- `main.py` — app factory (`create_app`): CORS, the bearer-gate middleware, the
  startup hook, and `include_router` for every domain. No business logic here.
- `core/` — cross-cutting infra: `security.py` (bearer gate + `current_user`
  dependency) and `cache.py` (the shared scan/trend/chart caches).
- `api/routes/` — one `APIRouter` per domain: `meta`, `auth`, `strategy`,
  `runs`, `signals`, `telegram`, `exchange`, `paper`, `portfolio`. Request models
  and route-local helpers live next to the routes that use them.
- `services/` — business logic, framework-agnostic: `auth`, `exchange`,
  `telegram`, `profit_engine`, `paper_trading`, `pinescript_parser`, `signals`
  (the scanner).
- `strategies/` — `base` (shared signal primitives), `bot1`, `bot4`.
- `engine/` — vendored TradingView-matching backtest engine (do not split/edit).
- `backtest/` — `runner` + `engine_adapter` bridging strategies ↔ engine.
- `data/` — OHLCV fetchers + symbol universes.
- `models.py`, `database.py` — Pydantic response models + the psycopg layer.

All internal imports are absolute and rooted at `app.` (e.g.
`from app.services import signals`).

## Build status (see MILESTONES.md for detail)
- **The Python backend is feature-complete.** M1 Foundation ✓ · M2 Signal engine ✓ ·
  M3 Backtest engine ✓ · M4 Data layer ✓ · M8 Trading integrations ✓ (exchange,
  profit engine, Telegram, paper trading). Every API route is live (0 stubs).
- **Remaining:** M5 typed TS client, M6/M7 the React dashboard, M9 wire-up
  (the APScheduler auto-scan + scheduled-Telegram-send jobs, and serving the
  built frontend alongside the API).
- **Deploying:** a full kit is included — `Dockerfile`, `docker-compose.yml`
  (API + Postgres + auto-HTTPS Caddy), `.env.example`, `Caddyfile`, and a
  step-by-step `DEPLOY.md` for a VPS + the Replit-managed domain. To deploy:
  follow `DEPLOY.md` (it's safe to run end to end).

## HARD RULES — do not break
1. **Never edit the indicator/execution math to change behavior.**
   `app/services/signals.py` (`_compute_pole`, `_gaussian_channel`) and the
   vendored `app/engine/` are faithfully reproduced and verified. Signal/entry/exit
   math belongs in `app/strategies/` `build_signals*`; trade execution + KPIs
   belong in `app/engine/` (driven by `app/backtest/engine_adapter.py`). To change
   strategy behavior, edit `app/strategies/` — not `app/engine/`.
2. **Regression tests are golden-master.** `python-backend/tests/` asserts exact
   KPIs/trade sequences. On an *intended* engine/signal change, regenerate the
   goldens deliberately — never tweak the engine just to make a test pass.
3. **Data layer is stubbed until M4.** `app/data/crypto.py`,
   `app/data/equities.py`, `app/data/market_exchange.py` return empty so the app
   stays healthy with no live data. Don't mistake "empty results" for a bug before M4.
4. **Money endpoints are PIN-gated** and keys are encrypted. Never log raw API
   keys or tokens; never weaken the PIN gate.
5. The UI is **Hebrew/RTL primary** with an EN toggle. Keep explain-modal copy
   matching the real backend formula, not invented narratives.

## Commands
- Run API: `cd python-backend && uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload`
- Tests:   `cd python-backend && python3 -m pytest`
- Env:     `DATABASE_URL` (Postgres). Optional `ADMIN_DEFAULT_PASSWORD` (default "admin").
           `SESSION_SECRET` is required before using any `/exchange/*` feature (it derives
           the Fernet key that encrypts stored API keys). Telegram/exchange need network.

## How to verify a change
Run the test suite, then exercise the affected endpoint via `/docs`. For engine
or signal changes, run the regression harness and confirm goldens are unchanged
(or regenerate them on purpose and note why).
