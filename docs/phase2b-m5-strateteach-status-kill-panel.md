# Phase 2B · M5 (UI) — StrateTeach reads Praxis status + unified kill — operator-apply packet

Status: **Ready to apply (read-only status + operator-confirmed kill).** Patch packet against the
StrateTeach dashboard (`dashboard/`, React 18 + Vite) in the 2026-07-19 baseline. Applied by the
**operator**. It ADDS a panel to the StrateTeach dashboard that reads Praxis's authoritative state
(`operator_pilot_fleet`, now venue-aware via EP7/migration 038) and exposes the **one** unified kill
(`operator_kill_all`). It changes nothing in StrateTeach's own logic and stores no secrets.

## Security principles (kill switch on a live money system)
- **Status is read-only.** The fleet view is a pure render of an operator-gated RPC; no mutation.
- **Kill is operator-authenticated + explicit-confirm + NEVER automatic.** `operator_kill_all` is
  gated server-side (`auth.uid()` + `profiles.is_operator`, RAISE 42501 otherwise). In the UI it is
  additionally gated by `canSubmitKill(reason, confirmed)` — a meaningful typed reason (≥ 8 chars) AND
  an explicit confirm — and it never fires on mount, on a timer, or from any signal. It is the operator
  pressing it, on purpose, with a reason that is audited.
- **Public anon key only** (`VITE_PRAXIS_SUPABASE_ANON_KEY`) — safe in the browser. The operator signs
  in with their **own** Praxis operator account via the login form; the password is handled by
  `supabase-js` and never stored by this code. **No `service_role` key ever reaches the browser.**
- **Additive + reversible:** a new tab/route; remove it (or unset the env) to fully revert.

## Step 1 — add the dependency
`dashboard/package.json` → add `"@supabase/supabase-js": "^2"` (already used by the Praxis frontend), then
`npm install`.

## Step 2 — `dashboard/src/lib/praxisStatusModel.ts` (pure, validated logic)

```ts
// Pure, UI-agnostic helpers for the Praxis status/kill panel (M5). Tested without React.
export interface FleetRow {
  id: string; trading_pair: string; bot_status: string; trading_enabled: boolean;
  exchange: string | null; exchange_environment: string | null;
  last_trade_status: string | null; last_block_reason: string | null;
}
export function normalizeFleet(raw: unknown): FleetRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: any) => ({
    id: String(r?.id ?? ""),
    trading_pair: String(r?.trading_pair ?? ""),
    bot_status: String(r?.bot_status ?? "unknown"),
    trading_enabled: r?.trading_enabled === true,
    exchange: r?.exchange ?? null,                       // EP7/mig038 venue name
    exchange_environment: r?.exchange_environment ?? null,
    last_trade_status: r?.last_trade_status ?? null,
    last_block_reason: r?.last_block_reason ?? null,
  }));
}
export function fleetSummary(rows: FleetRow[]): { total: number; enabled: number } {
  return { total: rows.length, enabled: rows.filter((r) => r.trading_enabled).length };
}
// Kill disables trading fleet-wide — require explicit confirm AND a meaningful typed reason.
export function canSubmitKill(reason: string, confirmed: boolean): boolean {
  return confirmed === true && typeof reason === "string" && reason.trim().length >= 8;
}
// 42501 = not an operator / not authenticated (matches the Praxis RPC deny).
export function isForbidden(err: any): boolean {
  return !!err && (err.code === "42501" || /forbidden|not authenticated|42501/i.test(String(err?.message ?? "")));
}
```

## Step 3 — `dashboard/src/lib/praxisClient.ts` (client + operator auth + RPC wrappers)

RPC names/args are byte-identical to the deployed Praxis frontend (`lib/pilot.ts`, `lib/actions.ts`) and
migration 019 `operator_kill_all(p_reason text, p_hard_lock boolean)`.

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_PRAXIS_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_PRAXIS_SUPABASE_ANON_KEY as string | undefined;

/** Null when unconfigured — the panel then shows a "configure Praxis" notice instead of failing. */
export const praxis: SupabaseClient | null =
  url && anon ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export async function operatorSignIn(c: SupabaseClient, email: string, password: string): Promise<void> {
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function operatorSignOut(c: SupabaseClient): Promise<void> { await c.auth.signOut(); }

/** Read-only fleet (operator_pilot_fleet). Throws the PostgrestError (42501) on denial. */
export async function fetchFleet(c: SupabaseClient): Promise<unknown> {
  const { data, error } = await c.rpc("operator_pilot_fleet");
  if (error) throw error;
  return data;
}
/** The ONE audited kill. reason is required by the UI gate; hard_lock defaults true (mirrors 019). */
export async function killAll(c: SupabaseClient, reason: string, hardLock = true): Promise<unknown> {
  const { data, error } = await c.rpc("operator_kill_all", {
    p_reason: reason && reason.length > 0 ? reason : null,
    p_hard_lock: hardLock,
  });
  if (error) throw error;
  return data;
}
```

## Step 4 — `dashboard/src/components/PraxisStatusPanel.tsx` (read-only fleet + gated kill)

```tsx
import { useEffect, useState } from "react";
import { praxis, operatorSignIn, operatorSignOut, fetchFleet, killAll } from "../lib/praxisClient";
import { normalizeFleet, fleetSummary, canSubmitKill, isForbidden, type FleetRow } from "../lib/praxisStatusModel";

export function PraxisStatusPanel() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [rows, setRows] = useState<FleetRow[]>([]); const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [confirm, setConfirm] = useState(false);
  const [killing, setKilling] = useState(false); const [killMsg, setKillMsg] = useState<string | null>(null);

  useEffect(() => { praxis?.auth.getSession().then(({ data }) => setAuthed(!!data.session)); }, []);
  async function refresh() {
    if (!praxis) return;
    try { setRows(normalizeFleet(await fetchFleet(praxis))); setErr(null); }
    catch (e: any) { setErr(isForbidden(e) ? "Not a Praxis operator (or not signed in)." : "Failed to load Praxis status."); }
  }
  useEffect(() => { if (authed) { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); } }, [authed]);

  if (!praxis) return <div>Praxis status unavailable — set VITE_PRAXIS_SUPABASE_URL / _ANON_KEY.</div>;

  if (!authed) return (
    <form onSubmit={async (e) => { e.preventDefault(); try { await operatorSignIn(praxis, email, password); setAuthed(true); } catch { setErr("Sign-in failed."); } }}>
      <h3>Praxis operator sign-in</h3>
      <input type="email" placeholder="operator email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      <button type="submit">Sign in</button>{err && <div role="alert">{err}</div>}
    </form>
  );

  const sum = fleetSummary(rows);
  async function onKill() {
    if (!praxis || !canSubmitKill(reason, confirm)) return;
    setKilling(true); setKillMsg(null);
    try { await killAll(praxis, reason.trim(), true); setKillMsg("Kill sent — trading disabled fleet-wide."); setConfirm(false); setReason(""); await refresh(); }
    catch (e: any) { setKillMsg(isForbidden(e) ? "Denied: not an operator." : "Kill failed — retry or use the Praxis console."); }
    finally { setKilling(false); }
  }

  return (
    <div>
      <div><button onClick={() => operatorSignOut(praxis!).then(() => setAuthed(false))}>Sign out</button> · {sum.enabled}/{sum.total} bots trading-enabled</div>
      {err && <div role="alert">{err}</div>}
      <table><thead><tr><th>Pair</th><th>Venue</th><th>Env</th><th>Status</th><th>Trading</th><th>Last trade</th><th>Last block</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td>{r.trading_pair}</td><td>{r.exchange ?? "—"}</td><td>{r.exchange_environment ?? "—"}</td>
          <td>{r.bot_status}</td><td>{r.trading_enabled ? "on" : "off"}</td><td>{r.last_trade_status ?? "—"}</td><td>{r.last_block_reason ?? "—"}</td></tr>
        ))}</tbody></table>

      <fieldset>
        <legend>Emergency kill (disables ALL trading — audited, operator-only)</legend>
        <input placeholder="reason (≥ 8 chars, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I understand this disables trading for {sum.enabled} bot(s).</label>
        <button disabled={!canSubmitKill(reason, confirm) || killing} onClick={onKill}>{killing ? "Sending…" : "KILL ALL"}</button>
        {killMsg && <div role="status">{killMsg}</div>}
      </fieldset>
    </div>
  );
}
```

Mount it on a new route/tab (e.g. `dashboard/src/App.tsx` router) behind the operator area. It is
self-contained; nothing else in the dashboard changes.

## Step 5 — config
`.env` (dashboard): `VITE_PRAXIS_SUPABASE_URL=<praxis-project-url>`,
`VITE_PRAXIS_SUPABASE_ANON_KEY=<praxis-anon-key>` (public). The operator signs in with their existing
Praxis operator account; no password is stored. If the vars are unset, the panel shows a config notice
and does nothing.

## Step 6 — test (validated; all assertions pass) — `dashboard/src/lib/praxisStatusModel.test.ts`
Covers `normalizeFleet` (defensive + carries the EP7 venue), `fleetSummary`, `canSubmitKill`
(confirm-AND-reason gating), and `isForbidden` (42501). (The same assertions ran green in review.)

```ts
import { describe, it, expect } from "vitest";
import { normalizeFleet, fleetSummary, canSubmitKill, isForbidden } from "./praxisStatusModel";
describe("praxisStatusModel", () => {
  const rows = normalizeFleet([
    { id: "b1", trading_pair: "BTCUSDT", bot_status: "active", trading_enabled: true, exchange: "binance", exchange_environment: "mainnet", last_trade_status: "filled" },
    { id: "b2", trading_pair: "ETHUSDT", trading_enabled: false },
  ]);
  it("normalizes defensively + carries venue", () => {
    expect(rows).toHaveLength(2); expect(rows[0].exchange).toBe("binance"); expect(rows[1].bot_status).toBe("unknown");
    expect(normalizeFleet(null)).toEqual([]);
  });
  it("summarizes", () => expect(fleetSummary(rows)).toEqual({ total: 2, enabled: 1 }));
  it("gates kill on confirm AND reason≥8", () => {
    expect(canSubmitKill("operator halt drawdown", true)).toBe(true);
    expect(canSubmitKill("operator halt drawdown", false)).toBe(false);
    expect(canSubmitKill("short", true)).toBe(false);
  });
  it("classifies 42501", () => { expect(isForbidden({ code: "42501" })).toBe(true); expect(isForbidden({ code: "23505" })).toBe(false); });
});
```

## Cross-boundary instrumentation (M5's timing half)
Praxis already emits per-order `trade_timing` (EP7) — the panel can surface those latencies per bot.
TRUE end-to-end timing (StrateTeach signal-emitted → Praxis webhook-received → order_ack) requires the
M2 shadow relay to be live *and* an emit-timestamp carried in the signal; that stitch-up is added when
M2 shadow is armed, not here.

## Rollback / scope
Remove the panel/route (or unset the env) to fully revert — additive, read-only-plus-one-gated-mutation.
M5 does NOT change execution: it only READS Praxis state and exposes the already-existing audited kill.
The kill is authoritative because Praxis is the execution engine (post-M3); pre-M3 it kills the Praxis
side only. Real funds remain NO-GO until M6 + the go-live blockers.
