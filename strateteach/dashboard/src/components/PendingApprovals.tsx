// PendingApprovals — 045 per-order approval (StrateTeach-style "the pilot never buys on its own").
// A LIVE bot proposes an order on each signal; the user decides to ENTER (Approve) or not (Reject). NO real
// order is placed until Approve. Polls list-proposals; Approve → approve-order (worker executes the real
// Praxis path). On-screen only. Renders nothing when there is nothing to approve.
import { useCallback, useEffect, useState } from "react";
import { api } from "../app/api";
import type { ProposedOrder } from "../lib/client";
import { C } from "../theme";

export function PendingApprovals({ he = false }: { he?: boolean }) {
  const [items, setItems] = useState<ProposedOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listProposals();
      setItems(r.proposals ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load_failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (id: string, kind: "approve" | "reject") => {
    setBusy(id);
    try {
      if (kind === "approve") await api.approveOrder(id);
      else await api.rejectOrder(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${kind}_failed`);
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null; // nothing pending → render nothing

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 14, background: C.surface }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{he ? "עסקאות ממתינות לאישור" : "Orders awaiting your approval"}</h3>
      {err && <div style={{ color: C.loss, fontSize: 13, marginBottom: 6 }}>{err}</div>}
      {items.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 14, color: C.text }}>
            <b style={{ color: p.side === "buy" ? C.gain : C.loss }}>{p.side.toUpperCase()}</b>{" "}
            {p.trading_pair}
            {p.requested_notional_usdt != null ? ` · $${p.requested_notional_usdt}` : ""}
            {p.price_at_signal != null ? ` @ ${p.price_at_signal}` : ""}
            <span style={{ color: C.muted, fontSize: 12 }}>{" · "}{he ? "פג בקרוב" : "expires soon"}</span>
          </span>
          <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button disabled={busy === p.id} onClick={() => act(p.id, "approve")}
              style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: C.gain, color: "#fff", cursor: busy === p.id ? "default" : "pointer", opacity: busy === p.id ? 0.6 : 1 }}>
              {he ? "אשר" : "Approve"}
            </button>
            <button disabled={busy === p.id} onClick={() => act(p.id, "reject")}
              style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.text, cursor: busy === p.id ? "default" : "pointer", opacity: busy === p.id ? 0.6 : 1 }}>
              {he ? "דחה" : "Reject"}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
