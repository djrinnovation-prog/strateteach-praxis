import { api } from "../app/api";

// ── Privacy-safe product analytics (Part F / Item 2) ────────────────────────────
// track(event, props) is a FIRE-AND-FORGET beacon: it never throws, never blocks a
// flow, and no-ops on any failure (offline, 404, not-logged-in). Only NON-SENSITIVE
// props should ever be passed (screen name, action id, ok/fail, error code, mode) —
// the BACKEND is the authority and additionally enforces a forbidden-key denylist +
// allowlist, so amounts / API keys / PII can never be persisted even if a caller slips.
//
// THREE-part identity: the server keys rows by a pseudonym (never the username); the
// client contributes a `session_id` (rotates per login / long inactivity); the internal
// user id is never sent. A CONSENT gate suppresses ALL emits until the user accepts
// (Item 3) — and the server independently rejects un-consented events (defence in depth).

// ── session id — client-generated, rotates per login or after long inactivity ────
const SESSION_KEY = "algo770_analytics_session";
const SESSION_TS_KEY = "algo770_analytics_session_ts";
const IDLE_MS = 30 * 60 * 1000; // 30 min inactivity → new session

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && (crypto as any).randomUUID) return (crypto as any).randomUUID();
  } catch { /* fall through */ }
  return "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function sessionId(): string {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(SESSION_TS_KEY) || 0);
    let sid = sessionStorage.getItem(SESSION_KEY) || "";
    if (!sid || (last && now - last > IDLE_MS)) {
      sid = uuid();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    sessionStorage.setItem(SESSION_TS_KEY, String(now));
    return sid;
  } catch {
    return "s-nostore";
  }
}

// Force a fresh session id on the next emit (called on login/logout).
export function rotateAnalyticsSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_TS_KEY); } catch { /* no-op */ }
}

// ── consent gate ─────────────────────────────────────────────────────────────────
// Cached client-side after login (see setAnalyticsConsent). `undefined` = unknown yet
// (before the consent probe resolves) → suppress, so we never emit pre-consent.
let _consent: boolean | undefined = undefined;

export function setAnalyticsConsentCache(v: boolean | undefined): void { _consent = v; }
export function analyticsConsent(): boolean | undefined { return _consent; }

// ── emit ──────────────────────────────────────────────────────────────────────────
let _lastScreen = "";

function emit(kind: "collect" | "event", event: string, props?: Record<string, unknown>): void {
  try {
    const ev = String(event || "").trim();
    if (!ev) return;
    if (_consent !== true) return; // suppress until consent is explicitly granted
    const sid = sessionId();
    const p = kind === "collect" ? api.collectEvent(ev, props, sid) : api.trackEvent(ev, props, sid);
    Promise.resolve(p).catch(() => { /* no-op */ });
  } catch { /* no-op */ }
}

// Generic beacon (pre-existing call-sites: screen_view, app_open, exchange_connect_*, …).
export function track(event: string, props?: Record<string, unknown>): void {
  if (event === "screen_view") {
    const s = String((props as any)?.screen || "");
    if (!s || s === _lastScreen) return; // dedupe consecutive views of the same screen
    _lastScreen = s;
  }
  emit("event", event, props);
}

// Convenience for screen-view tracking (used by the route-change hook).
export function trackScreen(screen: string): void {
  track("screen_view", { screen });
}

// ── the 12 canonical product events (strict /collect path, typed enums only) ────────
export type MarketClass = "crypto" | "stocks" | "metals" | "commodities";
export type ResultBucket = "none" | "1-3" | "4-10" | "10+";
export type StrategyKind = "gaussian" | "donchian" | "bollinger" | "keltner" | "other";
export type DurationBucket = "fast" | "normal" | "slow";

export function resultBucket(n: number): ResultBucket {
  if (!n || n <= 0) return "none";
  if (n <= 3) return "1-3";
  if (n <= 10) return "4-10";
  return "10+";
}
export function durationBucket(ms: number): DurationBucket {
  if (ms <= 3000) return "fast";
  if (ms <= 15000) return "normal";
  return "slow";
}

export const ev = {
  userLoggedIn: () => emit("collect", "user_logged_in"),
  dashboardViewed: () => emit("collect", "dashboard_viewed"),
  scannerViewed: () => emit("collect", "scanner_viewed"),
  scannerRunStarted: (market_class: MarketClass) => emit("collect", "scanner_run_started", { market_class }),
  scannerRunCompleted: (market_class: MarketClass, result_bucket: ResultBucket) => emit("collect", "scanner_run_completed", { market_class, result_bucket }),
  backtestStarted: (strategy_kind: StrategyKind) => emit("collect", "backtest_started", { strategy_kind }),
  backtestCompleted: (strategy_kind: StrategyKind, duration_bucket: DurationBucket) => emit("collect", "backtest_completed", { strategy_kind, duration_bucket }),
  strategyCreated: (strategy_kind: StrategyKind) => emit("collect", "strategy_created", { strategy_kind }),
  strategySaved: (strategy_kind: StrategyKind) => emit("collect", "strategy_saved", { strategy_kind }),
  validationErrorSeen: (screen: string, error_code: string) => emit("collect", "validation_error_seen", { screen, error_code }),
  blockedActionSeen: (action_kind: string, reason_code: string) => emit("collect", "blocked_action_seen", { action_kind, reason_code }),
  autopilotViewed: (pilot_no: number) => emit("collect", "autopilot_viewed", { pilot_no }),
};
