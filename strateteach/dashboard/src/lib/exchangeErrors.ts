// ── Exchange order-error → clear, actionable guidance ────────────────────────────
// Turns a raw exchange rejection (e.g. binance {"code":-2015,"msg":"Invalid API-key, IP,
// or permissions for action"}) into a friendly, actionable message. Matches BOTH the
// numeric code AND fuzzy-matches the message text, so other exchanges' equivalents are
// caught. DISPLAY ONLY — never affects order execution. The caller shows `friendly` and
// keeps `raw` in a small "details" expander for debugging.

export type MappedExchangeError = { friendly: string; raw: string; mapped: boolean; kind: string };

// Pull the exchange error code out of the raw string ("code":-2015 | (-2015) | -2015).
function extractCode(raw: string): number | null {
  const m = raw.match(/"?code"?\s*[:=]\s*(-?\d{3,5})/i) || raw.match(/(?:^|[\s(,])(-1\d{3}|-2\d{3})(?:$|[\s),.])/);
  return m ? Number(m[1]) : null;
}

// True when the text looks like a RAW exchange/library error (code, braces, provider name)
// rather than an already-human backend message we should pass through unchanged.
function looksRaw(raw: string): boolean {
  return /\{?\s*"?code"?\s*[:=]|binance|bybit|okx|kucoin|kraken|bitget|gate|coinbase|ccxt|apierror|exchangeerror|-1\d{3}|-2\d{3}/i.test(raw);
}

type Rule = { kind: string; test: (code: number | null, lo: string) => boolean; he: string; en: string };

// Ordered — most specific first (so -2015's "…permissions…" isn't caught by the auth rule).
const RULES: Rule[] = [
  {
    kind: "permissions",
    test: (c, m) => c === -2015 || /invalid api-?key[\s\S]*ip[\s\S]*permission|permissions? for (this )?action|ip[\s\S]*not[\s\S]*whitelist|permission denied/i.test(m),
    he: "מפתח ה-API של הבורסה אינו מורשה לבצע פקודות. בבורסה: הפעילו הרשאת מסחר (Spot/Margin) למפתח, והגדירו גישת IP ל-Unrestricted או הוסיפו את כתובת השרת שלנו ל-whitelist — ואז חברו מחדש את המפתח ונסו שוב.",
    en: "Your exchange API key can't place orders. On your exchange: enable Spot/Margin Trading permission on the key, and set IP access to Unrestricted OR whitelist our server's IP — then reconnect the key and retry.",
  },
  {
    kind: "auth",
    test: (c, m) => c === -2014 || c === -1022 || /signature[\s\S]*(not )?valid|invalid signature|api-?key format invalid|mandatory parameter[\s\S]*signature|not signed/i.test(m),
    he: "המפתח או הסוד של ה-API שגויים או לא נחתמו — הזינו מחדש את המפתח והסוד (בלי רווחים) וחברו מחדש.",
    en: "API key or secret is wrong or not signed — re-enter your key & secret (no spaces) and reconnect.",
  },
  {
    kind: "insufficient",
    test: (c, m) => c === -2010 || /insufficient|not enough|balance is insufficient|exceeds[\s\S]*balance/i.test(m),
    he: "אין מספיק יתרה לפקודה הזו — הפקידו או הקטינו את הסכום.",
    en: "Not enough balance for this order — top up or reduce the amount.",
  },
  {
    kind: "min_size",
    test: (c, m) => c === -1013 || /min_?notional|lot_?size|below[\s\S]*(minimum|min)|minimum notional|too small|filter failure/i.test(m),
    he: "הפקודה קטנה מהמינימום של הבורסה — הגדילו את הסכום.",
    en: "Order is below the exchange's minimum size — increase the amount.",
  },
  {
    kind: "symbol",
    test: (c, m) => c === -1121 || /invalid symbol|unknown symbol|not tradable|does not have market|symbol[\s\S]*not found/i.test(m),
    he: "הסימבול הזה אינו נסחר בבורסה המחוברת.",
    en: "This symbol isn't tradable on your connected exchange.",
  },
];

export function mapExchangeError(raw0: unknown, he: boolean): MappedExchangeError {
  const raw = String((raw0 as any)?.message ?? raw0 ?? "").trim();
  if (!raw) return { friendly: he ? "הבורסה דחתה את הפקודה." : "The exchange rejected this order.", raw, mapped: true, kind: "generic" };
  const code = extractCode(raw);
  const lo = raw.toLowerCase();
  for (const r of RULES) {
    if (r.test(code, lo)) return { friendly: he ? r.he : r.en, raw, mapped: true, kind: r.kind };
  }
  // No rule → if it's already a human sentence (backend guidance), pass it through; if it's a
  // raw/coded exchange error, show the generic line and keep the raw in the expander.
  if (!looksRaw(raw)) return { friendly: raw, raw, mapped: false, kind: "passthrough" };
  return { friendly: he ? "הבורסה דחתה את הפקודה." : "The exchange rejected this order.", raw, mapped: true, kind: "generic" };
}
