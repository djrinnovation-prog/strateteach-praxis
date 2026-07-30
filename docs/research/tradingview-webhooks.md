# TradingView Webhook Research Report

> **Status:** ✅ VERIFIED — reference only, **not a source of truth**, not a decision.
> **Classification:** Tier-3 Reference (non-authoritative) · _informs, never authorizes_. A gate never closes on this document; findings become binding only via the Decision Log / Architecture / Tier-1 evidence.

| Field | Value |
|---|---|
| **Owner / Custodian** | Oren |
| **Author** | deep-research workflow (18 sources · 25 claims · 3-vote adversarial verify · 0 killed) + Claude synthesis |
| **Created** | 2026-06-04 |
| **Last Verified** | 2026-06-04 |
| **Evidence Quality** | Official findings = primary TradingView docs, **HIGH** · Community findings = secondary vendor/blog/OSS, **MEDIUM** |
| **Review Trigger** | Re-verify when ANY of: (a) before WB1 schema freeze; (b) at the Sprint 3 gate close; (c) TradingView changes its webhook/alert docs or the published source-IP list; (d) 6 months elapsed (staleness check). |

**Derived Artifacts (planned):** TradingView Alert Template v1 · Queue Message Contract v1 · Edge Function Validation Checklist · Webhook Security Checklist · Redelivery/Duplicate-Signal Test Plan · TradingView Setup Guide section · 5 Decision-Log candidates (event-not-command; identity-in-path; signal_id server-synthesized; exclude env/exchange/size/price; 2xx-fast async).

**Cross-references:** WB1 (Queue Message Format) · Architecture (pipeline + auth boundary) · Decision Log (candidates above, when raised) · Setup Guide (alert template) · Sprint 2 Closure Review §7 (Sprint 3 entry).

---

_Honesty flag: no direct Reddit thread survived verification into the final cited source set. "Community pain points" are evidenced by (a) official TradingView docs that confirm the mechanism and (b) practitioner blogs/repos (TradersPost, supa.is, GitHub bots). Each pain point is graded by what actually backs it._

---

## 1. Executive Summary

**What matters most:** TradingView webhooks are **at-least-once, text-substituted, unsigned, and 3-second-timeout-bound.** That sentence dictates the receiver design. The platform's direction — _event-not-command, DB-owns-policy, minimal contract, server-enforced idempotency_ — is the correct response to documented behavior. The community's command-style payload is a convention, not a requirement, and is dangerous for a money system.

**Top 5 implications for Sprint 3:**
1. **Idempotency is mandatory and server-synthesized.** ≤4 sends per trigger + intrabar repeats + no stable per-trigger ID ⇒ `signal_id` derived server-side from `bot_id + bar_time + action`, enforced by a DB unique constraint. (WB1, WB6, WB7)
2. **Edge Function returns 2xx in <3s and processes async.** Validate → enqueue → 200. We own retries via pgmq. (WB5)
3. **Identity belongs in the URL path, not the JSON body.** Body can be corrupted by `{{strategy.order.alert_message}}`; TradingView sends no custom headers. A per-bot `/{bot_id}/{token}` path survives corruption and doubles as auth. (WB1, WB5, Security)
4. **Exclude size/price/exchange/environment/order_type from the wire — confirmed.** Repaint-prone or policy-owned; DB is authority. (WB1, WB6)
5. **Body shrinks to a directional event + advisory annotations.** Minimal contract validated. (WB1)

**Assumption changes:** two refinements, not reversals — (a) move `bot_id`/secret into the URL path; (b) `signal_id` is server-synthesized, not client-trusted.

## 2. Source Map

| Source | Type | What it proves | Reliability |
|---|---|---|---|
| [configure-webhook-alerts](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/) | Official | POST, ports 80/443, four source IPs | Official |
| [port-number](https://www.tradingview.com/support/solutions/43000529314-i-cannot-send-webhook-to-a-url-with-a-port-number/) | Official | Port 80/443 rule (corroborating) | Official |
| [use-a-variable-value](https://www.tradingview.com/support/solutions/43000531021-how-to-use-a-variable-value-in-alert/) | Official | Placeholders = text substitution; JSON→`application/json` else `text/plain` | Official |
| [strategy-alerts](https://www.tradingview.com/support/solutions/43000481368-strategy-alerts/) | Official | Strategy placeholder catalog; realtime-only firing | Official |
| [pine FAQ / alerts](https://www.tradingview.com/pine-script-docs/faq/alerts/) | Official | `alert_message` series-string; JSON-escaping warning; barstate.isconfirmed | Official |
| [webhook-resubmission](https://www.tradingview.com/support/solutions/43000735201-webhook-resubmission/) | Official | 3s timeout; 5xx-except-504 → resend ×3 (max 4 sends) | Official |
| [webhook-errors](https://www.tradingview.com/support/solutions/43000776894-what-do-errors-mean-when-sending-webhooks/) | Official | 4xx (incl. malformed JSON) & timeouts NOT retried | Official |
| [repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/), [execution-model](https://www.tradingview.com/pine-script-docs/language/execution-model/), [alert-mismatches](https://www.tradingview.com/support/solutions/43000774016-common-reasons-for-mismatches-between-strategy-alert-triggers-and-strategy-orders-on-the-chart/), [alert-frequencies](https://www.tradingview.com/support/solutions/43000474415-differences-between-alert-frequencies/) | Official | calc_on_every_tick intrabar; repaint real; Once-Per-Bar-Close mitigation | Official |
| [traderspost/tradingview](https://docs.traderspost.io/docs/learn/signal-sources/tradingview), [traderspost allowed-IPs](https://traderspost.io/reference/strategy-field/allowed-ip-addresses) | Vendor docs | The 7-field command payload; IP-list reproduction | Community pattern |
| [crosstrade.io](https://crosstrade.io/learn/pine-script/webhook-alerts), [supa.is](https://supa.is/article/tradingview-alert-once-per-bar-vs-once-per-bar-close-explained-2026), [traderspost blog](https://blog.traderspost.io/article/troubleshooting-webhook-issues-in-tradingview-a-comprehensive-guide) | Blog | Payload conventions; once-per-bar pain; troubleshooting | Community / anecdotal |
| [whook](https://github.com/germangar/whook), [CryptoGnome bot](https://github.com/CryptoGnome/Tradingview-Webhook-Bot), [lth-elm bot](https://github.com/lth-elm/TradingView-Webhook-Trading-Bot) | OSS repos | Real-world payload + secret-in-body practice | Community pattern |
| _Reddit threads_ | — | _None survived verification_ | (absent) |

## 3. Official TradingView Facts

- **Request method:** HTTP POST to a user-provided URL.
- **Body format:** raw `{{...}}` text substitution; no JSON object model; no auto-escaping.
- **JSON vs text/plain:** `application/json` iff the rendered string is valid JSON; else `text/plain`.
- **General placeholders:** `{{ticker}} {{close}} {{high}} {{low}} {{volume}} {{exchange}} {{interval}} {{time}} {{timenow}}`.
- **Strategy placeholders:** `{{strategy.order.action}}` (`buy`/`sell`), `.id`, `.contracts`, `.price`, `.comment`, `.alert_message` (arbitrary per-event series string), `{{strategy.position_size}}`, `{{strategy.market_position}}` (`long`/`flat`/`short`).
- **Timeout:** hard 3-second response window.
- **Allowed ports:** 80 and 443 only.
- **Source IPs (allowlist):** `52.89.214.238`, `34.212.75.30`, `54.218.53.128`, `52.32.178.7` — _published to be maintained; not immutable._
- **Failure behavior:** 5xx-except-504 → resend after 5s, max 3 resends (4 total sends); **4xx (incl. malformed JSON, auth, rate-limit) and timeouts are NOT retried** → silent drops possible.
- **Firing model:** strategy alerts fire realtime only, never on historical bars; default once-per-bar-close; `calc_on_every_tick=true` → intrabar early/extra fires; repainting officially real.
- **Security gaps (NOT confirmed — do not assume):** HTTPS is **not** documented as mandatory (only ports); **no built-in signing/HMAC/shared-secret** exists.

## 4. Common Community Patterns (payload contents)

**Common & useful (accept as EVENT signal):** `action`/side; `ticker`/`symbol` (only if multi-symbol); `strategy/order id` (correlation input); `time`/`bar_time`, `interval` (advisory).

**Common but risky (advisory only, never authoritative):** `price`, `quantity`, `position state`, `secret/passphrase in body`.

**Overbuilt for MVP (reject in v1):** `exchange`, `environment/testnet-live` flag, `order_type`, `leverage`, `stop-loss`/`take-profit`, `confidence`/indicator bundles, nested metadata blobs.

## 5. Community Pain Points (graded)

| Pain point | Grade | Basis |
|---|---|---|
| Duplicate alerts / same trigger repeated | Confirmed by official docs | Resubmission (≤4 sends) + intrabar |
| Repaint / early intrabar fire | Confirmed by official docs | repainting + mismatch + frequency pages |
| Silent missed/dropped webhooks | Confirmed by official docs | 4xx/timeout not retried |
| Malformed JSON from `alert_message` | Confirmed (mechanism) + common anecdote (frequency) | FAQ escaping warning; blogs |
| Idempotency needed on receiver | Confirmed (necessity) + common anecdote (practice) | at-least-once |
| Secret-in-body / IP-allowlist as security | Common anecdote | TradersPost/OSS |
| 3s timeout → process async | Confirmed by official docs | 3s cancellation rule |
| Broker/exchange execution mismatch | Common anecdote (corroborated by repaint note) | repaint page |

_No row rests on a single un-corroborated source._

## 6. Praxis Impact Analysis

**Finding classification, evidence & confidence:**

| Finding | Class | Evidence | Confidence |
|---|---|---|---|
| F1 POST / ports 80-443 | Official Fact | 2 primary | High |
| F2 Four source IPs | Official Fact | primary | High (mutable) |
| F3 JSON-vs-text by validity | Official Fact | primary | High |
| F4 Text-sub, alert_message can break JSON | Official Fact (+ hedged inference) | primary + FAQ | High |
| F5 Placeholder catalog | Official Fact | 3 primary | High |
| F6 At-least-once, 3s, ≤4 sends | Official Fact | primary | High |
| F7 4xx/timeout not retried | Official Fact | primary | High |
| F8 Realtime-only, intrabar, repaint | Official Fact | 2 primary | High |
| C-pat Command-style payload is the norm | Community Pattern | vendor + blogs | Medium |
| P-evt Message = event, not command | Praxis Conclusion | derived from F4/F6/F8 + C-pat | High |
| P-id signal_id server-synthesized | Praxis Conclusion | derived from F6/F8 | High |
| P-path Identity in URL path | Praxis Conclusion | derived from F4 | Medium-High |

**Impact map:**
- **WB1 (Queue Message Format):** body shrinks to `action`/side + advisory (`bar_time`, optional `market_position`); `bot_id`+token leave the body for the path; `signal_id` server-derived, not a wire field.
- **WB3 (pgmq + RPC):** queue is the durable retry/buffer that lets WB5 return 200 immediately; payload = minimal event + synthesized `signal_id`.
- **WB5 (Edge Function):** 2xx-fast + async enqueue; defensive parse (body may be invalid JSON / text/plain); identity from path; reject-to-DLQ on unparseable.
- **WB6 (Worker validation):** resolve `bot_id`→DB policy; validate `symbol` ∈ allow-list; atomic `INSERT … ON CONFLICT (signal_id) DO NOTHING`; wire `price`/`size`/`position` advisory only.
- **WB7 (redelivery test):** simulate ≤4 identical sends + intrabar-early duplicate; assert zero duplicate trades; assert silent-drop handling.
- **Security:** IP allowlist (maintained) + path token; HMAC authenticates sender not business correctness; HTTPS enforced at our edge regardless of TV silence.
- **Testing:** parse-fuzz corrupted `alert_message`; duplicate/replay; 4xx-no-retry drop; 3s-timeout async proof.
- **Setup Guide:** mandate `Once Per Bar Close`/`barstate.isconfirmed`; minimal double-quoted JSON; per-bot URL; `alert_message` escaping warning.
- **Future v1.1/v2:** advisory + (later) limit/order_type enter as additive optional (MINOR); environment/exchange remain permanently DB-only.

## 7. Adopt / Reject / Defer Matrix

| Finding / Pattern | Adopt | Reject | Defer | Reason |
|---|---|---|---|---|
| JSON payload body | ✅ | | | Standard; parse defensively |
| Minimal directional event body | ✅ | | | Event-not-command |
| TradingView placeholders | ✅ | | | Only source of signal data |
| `strategy.order.action` (side) | ✅ | | | Core event |
| `strategy.order.id` | ✅ (idempotency input) | | | Correlation; synthesize our own key |
| `symbol` in message | ⚠️ conditional | | | Only if bot multi-symbol |
| `quantity` in message | | ✅ | | Risk policy = DB; repaint-prone |
| `price` / `order_type` | | ✅ (v1) | ✅ (v1.1 limit) | Repaint-prone; premature complexity |
| `environment`/testnet flag | | ✅ (permanent) | | Catastrophic on wire; DB-only |
| `exchange` | | ✅ (permanent) | | Bot-bound in DB |
| `market_position` / `bar_time` | ✅ (advisory) | | | Reconciliation sanity-check |
| Raw payload storage | ✅ | | | Verbatim audit/forensics |
| Identity in URL path + token | ✅ | | | Survives JSON corruption; doubles as auth |
| Secret-in-body as sole auth | | ✅ | | Plaintext + corruptible |
| IP allowlist | ✅ (defense-in-depth, maintained) | | | List is mutable |
| HMAC signing | ✅ (our edge) | | | TV has none natively |
| 3s timeout → async 200 | ✅ | | | Mandatory |
| Rely on TradingView retries | | ✅ | | Too narrow (5xx-except-504) |
| Server-synthesized signal_id | ✅ | | | No stable TV per-trigger id |
| `Once Per Bar Close` guidance | ✅ (template) | | | Cuts intrabar dupes at source |

## 8. Recommended Praxis Principles

1. The message is an EVENT, not a command.
2. The DB owns all policy (exchange, environment, sizing, symbols, ownership).
3. The TradingView payload is untrusted input.
4. Authentication proves the sender, not business correctness.
5. Idempotency is server-enforced and server-synthesized.
6. No risk/sizing authority in the v1 payload.
7. Fail closed on DB-config ambiguity.
8. Return 2xx fast, process async.
9. Identity travels out-of-band of the corruptible body (URL path).

## 9. Proposed Changes to Current WB1 Thinking

**Already right (keep):** event-not-command; DB-as-policy; minimal contract; signal_id idempotency via DB constraint; exclude environment/exchange/size/price/order_type; effectively-once via `INSERT … ON CONFLICT`; fail-closed; advisory-not-authoritative for strategy state.

**Must change:** move `bot_id`+secret to the URL path; `signal_id` server-synthesized from `bot_id + bar_time + action`; body shrinks further; Edge Function spec gains "2xx within 3s, async, defensive parse, DLQ-on-unparseable."

**Remains open:** bot↔symbol cardinality; exact auth combination + HTTPS enforcement; dedup window length + canonical signal_id string; which advisory fields we accept (marked never-trusted).

**Must verify before freeze:** the bot-config table exists in the schema with exchange/environment/sizing/allowed-symbols/ownership; profiles/ownership linkage for multi-tenancy.

## 10. Follow-up Artifacts to Create Later

| Artifact | Purpose | Lives in | Becomes |
|---|---|---|---|
| This research report | Reusable reference | Git `docs/research/` + Notion 📚 Research | Reference doc |
| TradingView Alert Template v1 | Canonical Pine alert body + frequency | Setup Guide (Notion) | Implementation doc |
| Queue Message Contract v1 | The frozen WB1 schema | Architecture + Git | Decision Log entry |
| Edge Function Validation Checklist | WB5 behavior spec | Implementation doc | Impl doc |
| Webhook Security Checklist | IP allowlist + token/HMAC + HTTPS | Architecture + Setup Guide | Impl doc |
| Redelivery / Duplicate-Signal Test Plan | WB7 grounded test matrix | Test plan (Git/impl) | Impl doc |
| TradingView Setup Guide section | User-facing alert configuration | Setup Guide (Notion) | Onboarding narrative |

**Routing recommendation:**
- **→ Decision Log entries:** event-not-command; identity-in-URL-path; signal_id server-synthesized; exclude environment/exchange/size/price (permanent); Edge Function 2xx-fast + async (we own retries).
- **→ Architecture documentation:** at-least-once delivery model; event/policy authority boundary; three-hop pipeline with idempotency placement; security model (sender-auth vs business-authority).
- **→ Implementation docs:** placeholder catalog & alert template; IP allowlist values ("maintained, not constant"); validation/parse checklist; test matrix; setup steps.
