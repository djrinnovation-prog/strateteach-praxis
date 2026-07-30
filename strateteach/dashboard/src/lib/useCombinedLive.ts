import { useQuery } from "@tanstack/react-query";
import { api, loadAccounts, isOwner } from "../app/api";

// ── Shared LIVE combined-portfolio math — ONE source of truth for the real-money headline ──
// Consumed by BOTH Home (HomeGlance) and /overview (Dashboard) so the two screens can NEVER drift
// (Dan: Home showed the engine-only total while /overview showed the combined total). It sums the
// REAL wallet value across:
//   (a) every connected BROWSER sub-account — livePnl(creds) per account (loadAccounts), and
//   (b) the autopilots' server-side Bybit sub-account — /autopilots/balance (owner-gated).
// Simulated pilot / Signal-Bot P&L is NEVER folded in — real balances only (money-safety). All
// creds belong to THIS user (per-user isolation; nothing hardcoded/global). Returns null value/pct
// when nothing could be read (honest — never a fabricated number).
//
// Pilots invested base: the master live gate (AUTOPILOT_LIVE_ENABLED) is OFF, so the pilots aren't
// live-trading → the Bybit sub-account's CURRENT real balance == its deposited capital. So apValue
// joins the combined invested DENOMINATOR and the pilots' own real P&L is $0 (honest — no live
// trades yet). When live trading eventually starts this must switch to the RECORDED deposit, since
// the balance would then diverge from the deposit.
export type CombinedLive = {
  value: number | null;      // Σ real wallet value across all accounts (engine browser + pilots Bybit)
  pnl: number;               // Σ real growth vs invested base (sim excluded; pilots $0 while gate off)
  pct: number | null;        // pnl over the combined invested base
  today: number | null;      // Σ today's change across readable browser accounts
  invested: number;          // engine real base + pilots deposit (the denominator)
  base: number | null;       // invested when > 0, else null
  loading: boolean;          // first-load in flight (no cached data yet)
  na: boolean;               // nothing could be read (not loading, value null)
  failed: number;            // browser accounts whose balance couldn't be read
  apOk: boolean;             // the pilots' Bybit balance resolved
  apValue: number;           // the pilots' Bybit real balance (0 when not ok)
};

export function useCombinedLive(): CombinedLive {
  const owner = isOwner();
  const accts = loadAccounts();
  // (a) Per-browser-account real value — fault-tolerant: one account failing never breaks the sum.
  const allAcctQ = useQuery({
    queryKey: ["allAccountsPnl", accts.map((a) => a.id).join(",")],
    enabled: accts.length > 0, retry: false, refetchInterval: 30000,
    queryFn: async () => Promise.all(accts.map(async (a) => {
      try {
        const r: any = await api.livePnl({ key: a.key, secret: a.secret, passphrase: a.passphrase, name: a.name, env: a.env });
        const okA = r?.ok !== false;
        const value = okA && r?.totalValue != null ? Number(r.totalValue) : null;
        const growthPnl = okA && r?.growthPnl != null ? Number(r.growthPnl) : null;
        const invested = growthPnl != null && value != null ? value - growthPnl
          : (okA && r?.costBasis != null ? Number(r.costBasis) : (okA && r?.netDeposits != null ? Number(r.netDeposits) : null));
        const today = okA ? Number(r?.period?.today ?? r?.totalPnl ?? 0) : 0;
        return { id: a.id, label: a.label, ok: okA, value, growthPnl, invested, today };
      } catch { return { id: a.id, label: a.label, ok: false, value: null, growthPnl: null, invested: null, today: 0 }; }
    })),
  });
  // (b) The autopilots' Bybit sub-account real wallet balance (read-only; owner-gated server-side).
  // SAME ["apBalance"] key AutoPilots + Dashboard use → react-query dedupes the fetch.
  const apBalQ = useQuery({ queryKey: ["apBalance"], queryFn: () => api.autopilotBalance(), enabled: owner, staleTime: 30000, retry: 0, refetchInterval: 45000 });

  const rows: any[] = (allAcctQ.data as any[]) || [];
  const okRows = rows.filter((r) => r.ok && r.value != null);
  const acctValue = okRows.reduce((s, r) => s + Number(r.value || 0), 0);
  const acctGrowth = rows.reduce((s, r) => s + (r.growthPnl != null ? Number(r.growthPnl) : 0), 0);
  const acctInvestedSum = rows.reduce((s, r) => s + (r.invested != null ? Number(r.invested) : 0), 0);
  const acctToday = okRows.reduce((s, r) => s + Number(r.today || 0), 0);
  const failed = rows.filter((r) => !r.ok).length;
  const apBal: any = apBalQ.data;
  const apOk = apBal?.ok === true && apBal?.connected !== false;
  const apValue = apOk ? Number(apBal.totalUsd || 0) : 0;

  const value: number | null = (okRows.length > 0 || apOk) ? acctValue + apValue : null;
  const pilotsInvested = apOk ? apValue : 0;
  const invested = acctInvestedSum + pilotsInvested;
  const pnl = acctGrowth + (apOk ? (apValue - pilotsInvested) : 0);  // pilots growth == $0 while gate off; NEVER sim
  const today: number | null = okRows.length > 0 ? acctToday : null;
  const base = invested > 0 ? invested : null;
  const pct = base != null && base > 0 ? (pnl / base) * 100 : null;
  const loading = (accts.length > 0 && allAcctQ.isLoading && !allAcctQ.data) || (owner && apBalQ.isLoading && !apBalQ.data);
  const na = value == null && !loading;
  return { value, pnl, pct, today, invested, base, loading, na, failed, apOk, apValue };
}
