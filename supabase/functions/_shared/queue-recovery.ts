// queue-recovery.ts — Slice 4C (pgmq no-silent-loss) shared decision logic.
//
// Pure, runtime-agnostic helpers that decide what a DUPLICATE webhook delivery should do based on the
// existing webhook_logs row. Kept side-effect-free so every branch is unit-testable (node:test) without a
// Deno.serve / supabase harness — the webhook handler maps the decision to DB writes + HTTP status.
//
// State machine (see docs/production-slice-4c-pgmq-no-silent-loss-packet.md §3.1):
//   accepted  -> queued        (pgmq_send success)
//   accepted  -> queue_failed  (pgmq_send failure)
//   duplicate of queued/rejected            -> dedup success (no enqueue)
//   duplicate of queue_failed (under cap)   -> re-attempt enqueue
//   duplicate of STALE accepted (under cap) -> re-attempt enqueue   (crash-in-window recovery)
//   duplicate of FRESH accepted             -> do not race; retryable 503, no enqueue
//   duplicate at/over the attempt cap       -> exhausted; retryable 503, no enqueue
//
// The durable guarantee is the worker sweeper + worker idempotency, NOT TradingView retries; the 503s
// here are defense-in-depth only.

export const STALE_ACCEPTED_SECONDS = 60;
export const MAX_REQUEUE_ATTEMPTS = 5;

export type WebhookLogStatus = "accepted" | "queued" | "queue_failed" | "rejected";

export type DuplicateAction =
  | "dedup_success"        // queued/rejected -> idempotent 200, no enqueue
  | "reenqueue"            // queue_failed or stale accepted, under cap -> attempt enqueue
  | "exhausted"            // at/over the attempt cap -> 503, no enqueue (observable dead-letter)
  | "race_fresh_accepted"; // fresh accepted -> 503, no enqueue (don't race the in-flight original)

export interface DuplicateDecisionInput {
  status: WebhookLogStatus;
  /** webhook_logs.received_at as epoch ms. */
  receivedAtMs: number;
  /** current time as epoch ms. */
  nowMs: number;
  /** webhook_logs.requeue_attempts (sweeper-owned counter). */
  requeueAttempts: number;
  staleSeconds?: number;
  maxAttempts?: number;
}

/**
 * Decide the action for a duplicate delivery. Pure — no I/O, no clock read (nowMs is injected).
 */
export function decideDuplicateAction(input: DuplicateDecisionInput): DuplicateAction {
  const staleSeconds = input.staleSeconds ?? STALE_ACCEPTED_SECONDS;
  const maxAttempts = input.maxAttempts ?? MAX_REQUEUE_ATTEMPTS;
  const atCap = input.requeueAttempts >= maxAttempts;

  switch (input.status) {
    case "queued":
    case "rejected":
      return "dedup_success";

    case "queue_failed":
      return atCap ? "exhausted" : "reenqueue";

    case "accepted": {
      const ageMs = input.nowMs - input.receivedAtMs;
      const stale = ageMs >= staleSeconds * 1000;
      if (!stale) return "race_fresh_accepted";
      return atCap ? "exhausted" : "reenqueue";
    }
  }
}

/**
 * Narrow a stored raw_payload.action to a valid order side, or null if it is not buy/sell.
 * (Ingest already rejects non-buy/sell, so null here means a corrupt/legacy row — never enqueue it blindly.)
 */
export function sideFromAction(action: unknown): "buy" | "sell" | null {
  return action === "buy" || action === "sell" ? action : null;
}
