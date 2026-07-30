# algo770-strateteach — 770 Trend Diamonds

A multi-asset (crypto / stocks / metals / commodities) **daily breakout signal
scanner** built on the Gaussian-channel **BOT(8C)-770** strategy, with a
TradingView-matching backtester, paper trading, semi-automatic exchange trading
(PIN-gated), a Profit Engine, Telegram delivery, and a Hebrew/RTL dashboard.

This is a clean-room rebuild of the original, done in milestones. The original
codebase is the reference spec.

## Architecture

- **python-backend/** — FastAPI app; owns all real logic (signals, backtest
  engine, exchange, profit engine, paper trading) and talks to Postgres
  directly via psycopg 3. This is the API.
- **lib/** — shared TypeScript packages (OpenAPI spec, generated client + Zod
  types, Drizzle DB types). Added from Milestone 5 onward.
- **artifacts/dashboard/** — React + Vite + shadcn/ui dashboard. Added from
  Milestone 6 onward.

All state lives in **PostgreSQL** (`DATABASE_URL`). The whole API is bearer-token
gated by a global middleware; only `/healthz` and `/auth/login` are public.
Money-moving `/exchange/*` routes are additionally PIN-gated (`X-Exchange-Pin`).

### Backend layout (`python-backend/app/`)

The backend is a single Python package, `app`, with each concern in its own place:

```
app/
├── main.py            # create_app(): middleware, startup, router wiring
├── core/              # security (bearer gate, current_user) + shared caches
├── api/routes/        # one APIRouter per domain (auth, signals, runs,
│                      #   exchange, paper, telegram, strategy, portfolio, meta)
├── services/          # business logic: auth, exchange, telegram,
│                      #   profit_engine, paper_trading, pinescript_parser, signals
├── strategies/        # base + bot1 + bot4 signal builders
├── engine/            # vendored TradingView-matching backtest engine
├── backtest/          # runner + engine_adapter
├── data/              # OHLCV fetchers + symbol universes
├── models.py          # Pydantic response models
└── database.py        # psycopg 3 data-access layer
```

All internal imports are absolute (`from app.services import signals`). Run it
with `uvicorn app.main:app`.

## Run the backend (current state)

```bash
# 1. Provision Postgres and export its URL
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# 2. Install deps (uv or pip)
pip install -e ".[dev]"          # or: uv sync

# 3. Start the API
cd python-backend && ./start.sh   # uvicorn on :5000
```

Then:
- `GET  /healthz` → `{"status":"ok"}` (public)
- `POST /auth/login` with `{"username":"admin","password":"admin"}` → returns a
  bearer token (override the seed password with `ADMIN_DEFAULT_PASSWORD`)
- Every other route requires `Authorization: Bearer <token>`; unimplemented ones
  return `501` tagged with the milestone that will build them.
- Interactive docs at `/docs`.

## Status

See `MILESTONES.md`. **Milestone 1 (foundation) is complete:** data models,
Postgres layer + schema bootstrap, working auth gate, and the full route surface
locked in as stubs.
