# Internal Praxis Ops Console — Roadmap (SPEC ONLY, not approved for build)

**Status:** DRAFT for review. No code, no runtime, no DB writes, no implementation.
**Prime directive:** automation only ever *expands within* reversible / testnet /
audited / capped / revocable territory. The autonomy boundary for
**irreversible, money-moving, secret-handling, or production** actions **never moves** —
those stay human-gated in every phase, forever.
**Sequencing:** this roadmap does NOT change priorities. The next actual backend
milestone is the **WB7 measured run** (gated). Phase 0 is itself gated *behind* that run.

---

## Security invariants (ALL phases — non-negotiable)

- **Secrets:** the console NEVER reads, prints, logs, or stores secret values. Operator
  owns all secrets (Doppler/Vault). No `doppler secrets get`, no env dumps.
- **Irreversible / outward actions** — `git push`, Doppler/Railway config, production
  anything, **arm/fire or enabling queue consumption, which can cause testnet or
  production orders depending on environment and queued signals**, money movement:
  **human approval, every time.** No standing authorization covers these.
- **Testnet only** for any automation: relies on server-side `is_production:false`
  enforcement; the console cannot select environment.
- **DB:** read-only role for all reads. Any write is reversible, testnet-scoped,
  previewed, and written to `audit_logs`. No destructive/DDL ops. Migration 009 frozen.
- **Auditability:** every action the console takes (from Phase 2 on) is previewed before
  execution and recorded. Approval is per-action, not a blanket grant.
- **Kill switch:** any automated behavior is revocable instantly via a single flag.

---

## Phase 0 — WB7/WB8 Evidence Reporter
- **Purpose:** turn a measured-run's raw logs + read-only query outputs into a PASS/FAIL
  evidence summary against the runbook §6 criteria.
- **Reads:** captured worker JSON-line logs; operator-provided read-only SELECT outputs
  (it never connects to the DB itself → no secrets).
- **Allowed:** parse, aggregate (`max/P99 processing_duration_ms`, `read_ct` histogram,
  duplicate counts), emit markdown/terminal table.
- **Not allowed:** any DB connection, any write, any secret, any network call.
- **Security boundary:** pure function over files in → text out. Zero side effects.
- **Replaces:** manual grep + arithmetic + transcription when reviewing a run.
- **Worth building:** just-in-time, **after the first WB7 measured run**, against real
  captured logs (already the agreed decision).

## Phase 1 — Read-only Ops Console
- **Purpose:** one place to observe live worker/queue/trade state during reviews instead
  of ad-hoc SELECTs and log tailing.
- **Reads:** worker logs (live tail) + read-only DB views: queue depth, `message_processed`
  stream, `trades` by status, stuck `pending`/`unknown`, recent `audit_logs`, bot status.
- **Allowed:** display, filter, aggregate. **Observation only.**
- **Not allowed:** ANY mutation, any secret display, any environment switch.
- **Security boundary:** dedicated **read-only DB role** with no write grants; no secret
  fields selected; localhost/operator-scoped, no public surface.
- **Replaces:** the manual "run these SELECTs + grep logs" step in every review cycle.
- **Worth building:** after Phase 0 validates the log/DB read patterns, once monitoring
  recurs (e.g. multi-bot testnet runs) enough to justify a standing dashboard.

## Phase 2 — Assisted Operations (human approval per action)
- **Purpose:** collapse the "Claude drafts a command → operator pastes/runs it" relay for
  **routine reversible** ops — without removing the human decision.
- **Reads:** same as Phase 1.
- **Allowed (prepare, not auto-execute):** generate the exact previewed action for a
  reversible, non-trading op. **Candidate examples only** — e.g. re-queue a stuck signal,
  create a `reconciliation_job`, disable a misbehaving bot, set
  `QUEUE_VISIBILITY_TIMEOUT_S`. **Examples are illustrative; each requires separate
  design/review before becoming an allowed action.** Execution happens **only** after
  explicit per-action operator approval, with a full diff/SQL preview, and is audited.
- **Not allowed:** arm/fire, enabling queue consumption, any secret, `git push`,
  Doppler/Railway config, production, irreversible/destructive ops — all remain fully
  human-driven.
- **Security boundary:** preview-then-approve-then-audit on every action; approval is
  per-action and revocable; testnet-scoped; reversible-only allowlist (deny by default,
  and the allowlist itself is built one reviewed action at a time).
- **Replaces:** the slow 3-party relay for the small set of recurring reversible fixes.
- **Worth building:** once Phase 1 is trusted *and* the same reversible ops recur often
  enough that the relay is the bottleneck — not before.

## Phase 3 — Limited testnet automation
- **Purpose:** let the console execute a **narrow, enumerated** set of reversible
  **testnet-only** actions autonomously, inside hard guardrails, to cut toil on
  repetitive safe tasks.
- **Reads:** same as Phase 1.
- **Allowed (enumerated allowlist only):** e.g. auto-create `reconciliation_jobs` for
  detected stuck trades, auto-retry a clearly-transient failure, run a scripted measured
  sequence — each bounded by rate/quantity caps, a kill switch, and full audit. Every
  entry on this allowlist requires its own prior design/review.
- **Not allowed:** anything not on the explicit allowlist; **arm/fire on production**;
  enabling queue consumption outside the reviewed automation; money movement; secret
  handling; environment switching; production scope of any kind.
- **Security boundary:** standing authorization is **scoped + capped + revocable**, testnet
  enforced server-side, every action audited, instant kill switch; production stays 100%
  human-gated.
- **Replaces:** manual repetition of known-safe reversible testnet steps.
- **Worth building:** only after Phases 1–2 have a clean track record, and likely
  **post-Sprint-3** — never as a prerequisite for shipping current work.

---

## What this roadmap deliberately does NOT do
- Does not move arm/fire, queue-consumption enablement, push, Doppler/Railway, production,
  or secrets out of human hands — in any phase.
- Does not reprioritize: **WB7 measured run remains the next backend milestone.**
- Does not touch canon (`DECISIONS.md`) — a roadmap entry is added only on your approval.
