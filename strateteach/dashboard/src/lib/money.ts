import { toastError } from "./toast";
import { track } from "./analytics";
import { mapExchangeError } from "./exchangeErrors";

// ── Financial-safety helpers (Step 2) — timeout + honest error mapping ───────────
// Additive: these DON'T change any order/trade logic. They bound how long the UI
// waits for a money call, and turn a raw failure into an honest message (what
// happened · are funds safe · next step · support path — the support CTA is added by
// the toast itself). Used by every money mutation's error path.

export class TimeoutError extends Error {
  timeout = true;
  constructor() { super("timeout"); }
}

// Reject a money call after `ms` if the server hasn't answered. NOTE: this does NOT
// cancel the server-side order — it only stops the UI from hanging; the honest
// timeout message tells the user to VERIFY rather than assume (and we never auto-resubmit).
export function raceTimeout<T>(p: Promise<T>, ms = 30000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = setTimeout(() => reject(new TimeoutError()), ms);
    p.then((v) => { clearTimeout(h); resolve(v); }, (e) => { clearTimeout(h); reject(e); });
  });
}

type Lang = "he" | "en";

// Show a consistent, honest money-error toast.
//   `what`    — localised headline: WHAT happened ("Order rejected", "Close failed"…)
//   `nextStep`— optional localised next-step line (defaults to "try again in a moment")
// Timeouts are treated specially: funds-safety is UNKNOWN, so we tell the user to
// verify positions/balance and never claim the funds are untouched.
export function honestMoneyError(e: any, what: string, lang: Lang, nextStep?: string, op?: string) {
  const he = lang === "he";
  // Analytics (Errors KPI) — non-sensitive: the op id + an error CODE only.
  const code = e?.timeout ? "timeout" : (e?.status ? `http_${e.status}` : "error");
  track("money_error", { op: op || "unknown", code });
  if (e?.timeout) {
    toastError(what, {
      fundsSafe: false, support: true,
      body: he
        ? "לא התקבל אישור מהשרת בזמן. בדקו את הפוזיציות והיתרה לפני ניסיון חוזר — ייתכן שהפעולה כן בוצעה. אל תשלחו שוב באופן עיוור."
        : "No confirmation from the server in time. Check your positions & balance before retrying — the action may still have gone through. Don't blindly resubmit.",
    });
    return;
  }
  const detail = String(e?.message || e || "").trim().slice(0, 160);
  // If the failure is a recognised exchange rejection (bad key/permissions, insufficient
  // balance, below-minimum, unknown symbol…), LEAD with the clear, actionable guidance
  // instead of the raw code. Otherwise fall back to the next-step line + raw detail.
  const mapped = mapExchangeError(detail, he);
  const body = mapped.mapped && mapped.kind !== "generic"
    ? mapped.friendly
    : (nextStep || (he ? "נסו שוב בעוד רגע." : "Please try again in a moment.")) + (detail ? ` (${detail})` : "");
  toastError(what, { fundsSafe: true, support: true, body });
}

// ── Client-side amount validation (Step 3) — guard rails only; the SERVER stays
// authoritative. Returns { ok, message } with an honest localised message. ─────────
export type AmountVerdict = { ok: boolean; message?: string };
export function validateAmount(raw: string | number | null | undefined, opts: {
  lang: Lang;
  requirePositive?: boolean;   // reject 0 (default: 0 allowed)
  max?: number | null;         // hard ceiling (available balance / plan limit); null = no cap
  maxKind?: "balance" | "generic";  // wording for the over-max message
  allowEmpty?: boolean;        // empty string is OK (treated as unset / 0)
}): AmountVerdict {
  const he = opts.lang === "he";
  const s = raw == null ? "" : (typeof raw === "string" ? raw.trim() : String(raw));
  if (s === "") return opts.allowEmpty ? { ok: true } : { ok: false, message: he ? "יש להזין סכום חוקי" : "Enter a valid amount" };
  const n = Number(s);
  if (!isFinite(n) || isNaN(n)) return { ok: false, message: he ? "יש להזין מספר חוקי" : "Enter a valid number" };
  if (n < 0) return { ok: false, message: he ? "הסכום חייב להיות חיובי" : "Amount must be positive" };
  if (opts.requirePositive && n <= 0) return { ok: false, message: he ? "הסכום חייב להיות גדול מאפס" : "Amount must be greater than zero" };
  const ceiling = opts.max == null ? 1e12 : opts.max;
  if (n > ceiling) {
    return opts.maxKind === "balance"
      ? { ok: false, message: he ? "הסכום גבוה מהיתרה הזמינה בחשבון" : "Amount exceeds your available balance" }
      : { ok: false, message: he ? "הסכום גדול מדי" : "Amount is too large" };
  }
  return { ok: true };
}
