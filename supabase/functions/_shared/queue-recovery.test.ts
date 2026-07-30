// queue-recovery.test.ts — Slice 4C decision-logic unit tests. Runtime-agnostic (node:test).
// Run: node --test supabase/functions/_shared/queue-recovery.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideDuplicateAction,
  sideFromAction,
  STALE_ACCEPTED_SECONDS,
  MAX_REQUEUE_ATTEMPTS,
  type WebhookLogStatus,
} from "./queue-recovery.ts";

const NOW = 1_000_000_000_000; // fixed epoch ms
const base = { nowMs: NOW, requeueAttempts: 0, receivedAtMs: NOW };

test("queued -> dedup_success (idempotent, no enqueue)", () => {
  assert.equal(decideDuplicateAction({ ...base, status: "queued" }), "dedup_success");
});

test("rejected -> dedup_success (terminal, no enqueue)", () => {
  assert.equal(decideDuplicateAction({ ...base, status: "rejected" }), "dedup_success");
});

test("queue_failed under cap -> reenqueue", () => {
  assert.equal(
    decideDuplicateAction({ ...base, status: "queue_failed", requeueAttempts: MAX_REQUEUE_ATTEMPTS - 1 }),
    "reenqueue",
  );
});

test("queue_failed at cap -> exhausted", () => {
  assert.equal(
    decideDuplicateAction({ ...base, status: "queue_failed", requeueAttempts: MAX_REQUEUE_ATTEMPTS }),
    "exhausted",
  );
});

test("queue_failed over cap -> exhausted", () => {
  assert.equal(
    decideDuplicateAction({ ...base, status: "queue_failed", requeueAttempts: MAX_REQUEUE_ATTEMPTS + 3 }),
    "exhausted",
  );
});

test("fresh accepted (age < N) -> race_fresh_accepted (no enqueue, no race)", () => {
  const receivedAtMs = NOW - (STALE_ACCEPTED_SECONDS - 1) * 1000; // 59s old
  assert.equal(
    decideDuplicateAction({ ...base, status: "accepted", receivedAtMs }),
    "race_fresh_accepted",
  );
});

test("stale accepted (age >= N) under cap -> reenqueue (crash-window recovery)", () => {
  const receivedAtMs = NOW - (STALE_ACCEPTED_SECONDS + 5) * 1000; // 65s old
  assert.equal(
    decideDuplicateAction({ ...base, status: "accepted", receivedAtMs }),
    "reenqueue",
  );
});

test("stale accepted boundary (age exactly N) -> reenqueue (>= is stale)", () => {
  const receivedAtMs = NOW - STALE_ACCEPTED_SECONDS * 1000; // exactly 60s old
  assert.equal(
    decideDuplicateAction({ ...base, status: "accepted", receivedAtMs }),
    "reenqueue",
  );
});

test("stale accepted at cap -> exhausted", () => {
  const receivedAtMs = NOW - (STALE_ACCEPTED_SECONDS + 5) * 1000;
  assert.equal(
    decideDuplicateAction({ ...base, status: "accepted", receivedAtMs, requeueAttempts: MAX_REQUEUE_ATTEMPTS }),
    "exhausted",
  );
});

test("custom staleSeconds / maxAttempts overrides are honored", () => {
  // 10s threshold: a 12s-old accepted row is stale.
  assert.equal(
    decideDuplicateAction({ status: "accepted", nowMs: NOW, receivedAtMs: NOW - 12_000, requeueAttempts: 0, staleSeconds: 10 }),
    "reenqueue",
  );
  // maxAttempts=1: a single prior attempt is already exhausted.
  assert.equal(
    decideDuplicateAction({ ...base, status: "queue_failed", requeueAttempts: 1, maxAttempts: 1 }),
    "exhausted",
  );
});

test("sideFromAction narrows only buy/sell", () => {
  assert.equal(sideFromAction("buy"), "buy");
  assert.equal(sideFromAction("sell"), "sell");
  assert.equal(sideFromAction("BUY"), null);
  assert.equal(sideFromAction(""), null);
  assert.equal(sideFromAction(undefined), null);
  assert.equal(sideFromAction(null), null);
  assert.equal(sideFromAction(42), null);
});

test("exhaustive: every status is handled (no undefined)", () => {
  const statuses: WebhookLogStatus[] = ["accepted", "queued", "queue_failed", "rejected"];
  for (const status of statuses) {
    const d = decideDuplicateAction({ ...base, status });
    assert.ok(["dedup_success", "reenqueue", "exhausted", "race_fresh_accepted"].includes(d), `status ${status} -> ${d}`);
  }
});
