# M4 cross-user isolation check (INV-9) — bot-status + pause-bot

`bot-status` and `pause-bot` bypass RLS (service_role), so their SOLE cross-user isolation control is the
hand-written `.eq("user_id", praxis_user_id)` predicate. This is the single most load-bearing security
control in M4. It is verified LIVE against a 2-user setup:

1. Provision two shadow identities A and B (distinct st_ref), create one bot for each.
2. `bot-status` with A's `read_status` ticket → returns **only** A's bot (B's absent).
3. `pause-bot` with A's `pause_bot` ticket naming **B's** bot_id → **404** (ownership predicate blocks it).
4. Control: A pausing A's own bot → 200.

Verified 2026-07-30 (all three assertions green). The signed driver lives in the session scratchpad
(`m4_isolation.ts`): it reads the local pepper, mints the tickets in-process, and calls the served
functions.

**Tracked follow-up:** promote this to a CI integration test (spin the local stack, run the driver, fail
the build if step 2 leaks B's bot or step 3 returns 200) so a future refactor that drops the `.eq` filter
is caught automatically. Until then this manual check gates any change to those two functions.
