// Phase 2C (Option A) · M5 — the end-user "Connect to Praxis" flow on the NEW secure rails.
//
// The exchange key is POSTed STRAIGHT to Praxis (connect-credential) and is NEVER sent to StrateTeach and
// NEVER stored in the browser/localStorage — it lives only in transient component state during submit and
// is wiped immediately after. StrateTeach only mints signed tickets (the identity/authority); Praxis owns
// the bot, the key (Vault), execution, and the kill switch.
import { useEffect, useState } from "react";
import { api } from "../app/api";
import { praxisFn, PRAXIS_FN_BASE } from "../lib/client";
import { PendingApprovals } from "../components/PendingApprovals";

// ── TradingView connect helpers (ported from the original SignalBots UX) ─────
// The webhook is PUBLIC + token-gated: POST {base}/webhook/{bot_id}/{url_token}.
// PRAXIS_FN_BASE is "/pfn" (the single-origin Caddy proxy) by default, so the
// absolute URL is derived from the current origin; an absolute override is used as-is.
function praxisWebhookUrl(bot_id: string, url_token: string): string {
  const base = PRAXIS_FN_BASE.startsWith("http")
    ? PRAXIS_FN_BASE.replace(/\/+$/, "")
    : `${window.location.origin}${PRAXIS_FN_BASE}`.replace(/\/+$/, "");
  return `${base}/webhook/${bot_id}/${url_token}`;
}
// Canonical TradingView alert Message. The bot is identified by the webhook URL —
// the body only needs a unique signal_id (dedup anchor; {{timenow}} makes each
// firing unique) + the action. Two alerts: one buy (entry), one sell (exit).
const alertTemplate = (action: "buy" | "sell") =>
  `{"signal_id": "{{ticker}}-${action}-{{timenow}}", "action": "${action}"}`;

// Small copy-to-clipboard button with a transient "Copied ✓" state (SignalBots-style).
function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1600); }
    catch { /* clipboard unavailable — the value is visible for manual copy */ }
  };
  return (
    <button type="button" onClick={copy} style={{
      padding: "4px 10px", borderRadius: 6, border: "1px solid #3a3a4a", background: "#1a1a26",
      color: "#e8e8ef", cursor: "pointer", fontSize: 12, flexShrink: 0,
    }}>
      {done ? "Copied ✓" : (label || "Copy")}
    </button>
  );
}

type Bot = {
  id: string; name: string; trading_pair: string; status: string;
  trading_enabled: boolean; sell_enabled?: boolean; credential_id: string | null;
  credential_status?: string | null; execution_mode?: string | null;
};

export default function PraxisConnect() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [linkErr, setLinkErr] = useState<string>("");
  const [bots, setBots] = useState<Bot[]>([]);
  const [busy, setBusy] = useState(false);              // connect FORM only — never gates KILL
  const [pendingBots, setPendingBots] = useState<Set<string>>(new Set()); // per-bot validate/arm in-flight (concurrent-safe)
  const addPending = (id: string) => setPendingBots((s) => new Set(s).add(id));
  const delPending = (id: string) => setPendingBots((s) => { const n = new Set(s); n.delete(id); return n; });
  const [err, setErr] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [once, setOnce] = useState<{ bot_id: string; url_token: string; pause_token: string } | null>(null);

  // form
  const [pair, setPair] = useState("BTCUSDT");
  const [notional, setNotional] = useState("11");
  const [exchange] = useState("binance");
  const [env, setEnv] = useState("testnet");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  async function ensureLinked() {
    try { await api.praxisLink(); setLinked(true); }
    catch (e: any) { setLinked(false); setLinkErr(e?.message || "link_failed"); }
  }
  async function loadBots(): Promise<Bot[]> {
    try {
      const { ticket } = await api.praxisStatusTicket();
      const { bots } = await praxisFn<{ bots: Bot[] }>("bot-status", { ticket });
      setBots(bots || []);
      return bots || [];
    } catch (e: any) { setErr(e?.message || "status_failed"); return []; }
  }
  useEffect(() => { (async () => { await ensureLinked(); await loadBots(); })(); }, []);

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOnce(null); setBusy(true);
    try {
      await api.praxisLink();
      // 1) create the bot in Praxis
      const { ticket: bt } = await api.praxisBotTicket();
      const bot = await praxisFn<{ bot_id: string; url_token: string; pause_token: string }>("create-bot", {
        ticket: bt, trading_pair: pair.trim().toUpperCase(),
        sizing_mode: "fixed_notional", fixed_notional_usdt: Number(notional),
        max_order_notional_usdt: Math.max(Number(notional), 50), daily_notional_cap_usdt: 1000,
      });
      // 2) connect the KEY — STRAIGHT to Praxis (never to StrateTeach)
      const { ticket: ct } = await api.praxisCredentialTicket(bot.bot_id, exchange, env);
      await praxisFn("connect-credential", { ticket: ct, api_key: apiKey, api_secret: apiSecret });
      // wipe the key from memory immediately
      setApiKey(""); setApiSecret("");
      setOnce({ bot_id: bot.bot_id, url_token: bot.url_token, pause_token: bot.pause_token });
      await loadBots();
    } catch (e: any) { setErr(e?.message || "connect_failed"); }
    finally { setBusy(false); }
  }

  // KILL is the emergency stop. It must NEVER be gated by an unrelated in-flight action (a validate
  // poll on another bot, a connect, etc.), so it does NOT touch the shared `busy` flag and its button
  // is never disabled. pause-bot is idempotent, so a double-click is harmless.
  async function onKill(bot_id: string) {
    setErr("");
    try {
      const { ticket } = await api.praxisPauseTicket(bot_id);
      await praxisFn("pause-bot", { ticket });
      await loadBots();
    } catch (e: any) { setErr(e?.message || "kill_failed"); }
  }

  // Validate the connected key: StrateTeach mints a validate_credential ticket → Praxis enqueues a
  // read-only worker check (fetchBalance, NEVER an order). Validation is ASYNC, so poll bot-status until
  // the credential leaves 'pending_validation'. The key never passes through here.
  async function onValidate(bot_id: string) {
    setErr(""); setNote(""); addPending(bot_id);
    try {
      const { ticket } = await api.praxisValidateTicket(bot_id);
      await praxisFn("validate-credential", { ticket });
      setNote("Validating key… (checking it authenticates)");
      // Poll up to ~30s for the worker to resolve the status. Only THIS bot's validate/arm buttons are
      // disabled meanwhile (pendingBot) — KILL on every bot stays live.
      let resolved: string | null = "pending_validation";
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const list = await loadBots();
        resolved = list.find((b) => b.id === bot_id)?.credential_status ?? null;
        if (resolved && resolved !== "pending_validation") break;
      }
      setNote(
        resolved === "valid"   ? "Key validated ✓ — you can arm the bot."
        : resolved === "invalid" ? "Key rejected by the exchange — check permissions/IP and reconnect."
        : "Still validating — refresh in a moment.",
      );
    } catch (e: any) { setErr(e?.message || "validate_failed"); }
    finally { delPending(bot_id); }
  }

  // Arm: allowed ONLY after the credential is 'valid' (arm-bot re-checks server-side + refuses mainnet
  // unless the double-gate is open). mode='simulation' (default) runs signals as SIMULATED fills — no real
  // order is ever placed. mode='live' is the deliberate go-live: each signal is PROPOSED and you approve it
  // before the (unchanged) Praxis money-path executes.
  async function onArm(bot_id: string, mode: "simulation" | "live") {
    // Go-live is the moment real orders become possible (after your approval) — confirm explicitly.
    if (mode === "live" && !window.confirm(
      "Go LIVE?\n\nAfter this, each incoming signal becomes an order PROPOSAL. Nothing is placed on the " +
      "exchange until YOU approve it. Real funds only if this bot's key is a mainnet key.\n\nContinue?"
    )) return;
    setErr(""); setNote(""); addPending(bot_id);
    try {
      const { ticket } = await api.praxisArmTicket(bot_id);
      await praxisFn("arm-bot", { ticket, mode });
      setNote(mode === "live"
        ? "Bot is LIVE — each signal will wait for your approval above."
        : "Bot armed in SIMULATION — signals run as dry-run fills, no real orders.");
      await loadBots();
    } catch (e: any) { setErr(e?.message || "arm_failed"); }
    finally { delPending(bot_id); }
  }

  const card: React.CSSProperties = { border: "1px solid #2a2a3a", borderRadius: 10, padding: 16, margin: "12px 0", background: "rgba(255,255,255,0.02)" };
  const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", margin: "4px 0 10px", borderRadius: 8, border: "1px solid #3a3a4a", background: "#12121a", color: "#e8e8ef" };
  const btn: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600 };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 16, color: "#e8e8ef" }}>
      <h2>Connect exchange → Praxis</h2>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        Your API key goes <b>straight to Praxis Vault</b> — it never touches StrateTeach and is never stored in
        this browser. StrateTeach only signs the authorization.
      </p>

      {/* 045 — orders a LIVE bot has proposed and is waiting for you to approve. Renders nothing when empty. */}
      <PendingApprovals />

      {linked === false && <div style={{ ...card, borderColor: "#a33" }}>Not linked to Praxis: {linkErr}</div>}
      {err && <div style={{ ...card, borderColor: "#a33" }}>Error: {err}</div>}
      {note && <div style={{ ...card, borderColor: "#3a7" }}>{note}</div>}

      <form onSubmit={onConnect} style={card}>
        <label>Trading pair</label>
        <input style={inp} value={pair} onChange={(e) => setPair(e.target.value)} placeholder="BTCUSDT" />
        <label>Order size (USDT, fixed)</label>
        <input style={inp} value={notional} onChange={(e) => setNotional(e.target.value)} inputMode="decimal" />
        <label>Exchange / environment</label>
        <select style={inp} value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="testnet">{exchange} · testnet</option>
          <option value="mainnet">{exchange} · mainnet (real funds)</option>
        </select>
        <label>API key</label>
        <input style={inp} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="trade-only, no withdrawal" />
        <label>API secret</label>
        <input style={inp} type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" />
        <button style={{ ...btn, background: "#4f7cff", color: "white", opacity: busy ? 0.6 : 1 }} disabled={busy || !apiKey || !apiSecret}>
          {busy ? "Connecting…" : "Create bot + connect key"}
        </button>
      </form>

      {once && (
        <div style={{ ...card, borderColor: "#3a7" }}>
          <b>Bot created + key connected ✓ — now connect TradingView</b>
          <p style={{ fontSize: 13, opacity: 0.8, margin: "6px 0 10px" }}>
            Shown <b>once</b> — copy everything below now. In TradingView: create an alert on your strategy →
            Notifications → enable <b>Webhook URL</b> → paste the URL; paste the message into <b>Message</b>.
          </p>

          <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.8 }}>Webhook URL (paste in TradingView → Webhook URL)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <code style={{ flex: 1, wordBreak: "break-all", background: "#12121a", border: "1px solid #3a3a4a", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}>
              {praxisWebhookUrl(once.bot_id, once.url_token)}
            </code>
            <CopyBtn value={praxisWebhookUrl(once.bot_id, once.url_token)} />
          </div>

          <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.8 }}>Alert message — BUY (entry alert)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <code style={{ flex: 1, wordBreak: "break-all", background: "#12121a", border: "1px solid #3a3a4a", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}>
              {alertTemplate("buy")}
            </code>
            <CopyBtn value={alertTemplate("buy")} />
          </div>

          <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.8 }}>Alert message — SELL (exit alert, if the bot has sell enabled)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <code style={{ flex: 1, wordBreak: "break-all", background: "#12121a", border: "1px solid #3a3a4a", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}>
              {alertTemplate("sell")}
            </code>
            <CopyBtn value={alertTemplate("sell")} />
          </div>

          <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.8 }}>
            Kill token — stops the bot even if this app is down. Store it somewhere safe (NOT in TradingView).
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, wordBreak: "break-all", background: "#12121a", border: "1px solid #3a3a4a", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}>
              {once.pause_token}
            </code>
            <CopyBtn value={once.pause_token} />
          </div>

          <p style={{ fontSize: 12, opacity: 0.65, margin: "10px 0 0" }}>
            Webhook alerts require a TradingView paid plan. Each firing sends a unique signal_id (dedup-safe).
            Next: Validate the key below, then Arm (simulation).
          </p>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>My bots</h3>
      {bots.length === 0 && <p style={{ opacity: 0.6 }}>No bots yet.</p>}
      {bots.map((b) => {
        const cs = b.credential_status ?? (b.credential_id ? "pending_validation" : null);
        const csLabel =
          cs === "valid" ? "validated ✓"
          : cs === "invalid" ? "rejected ✗"
          : cs === "pending_validation" ? "not validated"
          : "—";
        const csColor = cs === "valid" ? "#3a7" : cs === "invalid" ? "#c0392b" : "#c9a227";
        const rowPending = pendingBots.has(b.id); // this bot has an in-flight validate/arm
        return (
          <div key={b.id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div><b>{b.trading_pair}</b> · {b.status}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                trading {b.trading_enabled ? "ON" : "off"} · key {b.credential_id ? "connected" : "—"}
                {" · "}<span style={{ color: csColor }}>{csLabel}</span>
                {b.trading_enabled && (
                  b.execution_mode === "live"
                    ? <span style={{ color: "#c0392b", fontWeight: 700 }}>{" · "}LIVE — you approve each order</span>
                    : <span style={{ color: "#c9a227", fontWeight: 700 }}>{" · "}SIMULATION</span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {b.credential_id && cs !== "valid" && (
                <button style={{ ...btn, background: "#4f7cff", color: "white", opacity: rowPending ? 0.6 : 1 }} disabled={rowPending} onClick={() => onValidate(b.id)}>
                  {rowPending ? "Validating…" : "Validate key"}
                </button>
              )}
              {/* Arm = SIMULATION first (dry-run, no real orders). */}
              {cs === "valid" && !b.trading_enabled && (
                <button style={{ ...btn, background: "#2e8b57", color: "white", opacity: rowPending ? 0.6 : 1 }} disabled={rowPending} onClick={() => onArm(b.id, "simulation")}>
                  Arm (simulation)
                </button>
              )}
              {/* Deliberate go-live: only offered once armed in simulation. Confirms, then each signal proposes. */}
              {cs === "valid" && b.trading_enabled && b.execution_mode !== "live" && (
                <button style={{ ...btn, background: "#b8860b", color: "white", opacity: rowPending ? 0.6 : 1 }} disabled={rowPending} onClick={() => onArm(b.id, "live")}>
                  Go live
                </button>
              )}
              {/* KILL is the emergency stop — NEVER disabled by an in-flight action (audit HIGH). */}
              <button style={{ ...btn, background: "#c0392b", color: "white" }} onClick={() => onKill(b.id)}>
                KILL
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
