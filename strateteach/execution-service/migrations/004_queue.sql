-- 004_queue.sql — the durable queue (Phase 1, slice 3).
--
-- Spec §1/§10.3: between ingress and the (future) worker sits a DURABLE queue —
-- nothing is lost silently, and a crashed consumer's items are recovered by a
-- sweeper. §10.3 left the technology open with pgmq recommended; this ships the
-- SAME semantics in plain Postgres (FOR UPDATE SKIP LOCKED), because:
--   * zero new dependencies / extensions — runs on ANY managed Postgres;
--   * the whole mechanism is ~one table + four statements, readable in review;
--   * queue.py isolates the API, so swapping to pgmq later is one module.
--
-- One row per ACCEPTED signal (UNIQUE signal_row_id = enqueue is idempotent).
-- Lifecycle: queued → processing → done | failed→queued (retry, delayed)
--            → dead (attempts exhausted; nothing consumes it, owners inspect).
-- The gate stays DISARMED in Phase 1, so in practice nothing is ever enqueued
-- outside tests — this is infrastructure ahead of its (gated) consumer.

BEGIN;

CREATE TABLE IF NOT EXISTS exec_queue (
    id             BIGSERIAL PRIMARY KEY,
    signal_row_id  BIGINT      NOT NULL UNIQUE REFERENCES exec_signals(id) ON DELETE RESTRICT,
    bot_id         BIGINT      NOT NULL REFERENCES exec_bots(id) ON DELETE RESTRICT,
    status         TEXT        NOT NULL DEFAULT 'queued',
    attempts       INTEGER     NOT NULL DEFAULT 0,
    max_attempts   INTEGER     NOT NULL DEFAULT 5,
    -- when the item becomes claimable (NOW for fresh items; future = delayed retry)
    visible_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by      TEXT,
    locked_at      TIMESTAMPTZ,
    last_error     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exec_queue_status CHECK (status IN ('queued', 'processing', 'done', 'dead')),
    CONSTRAINT exec_queue_attempts_sane CHECK (attempts >= 0 AND max_attempts > 0)
);

-- The dequeue hot path: claimable items in arrival order.
CREATE INDEX IF NOT EXISTS exec_queue_claimable_idx ON exec_queue (status, visible_at, id);

COMMENT ON TABLE exec_queue IS
    'Durable signal queue (slice 3): SKIP LOCKED claim, delayed retry, dead-letter. Operator-visible.';

-- The operator runs the machine — the queue is part of the exec plane (spec §7).
DO $$
BEGIN
    GRANT SELECT, INSERT, UPDATE ON exec_queue TO exec_operator_role;
    GRANT USAGE, SELECT ON SEQUENCE exec_queue_id_seq TO exec_operator_role;
EXCEPTION
    WHEN insufficient_privilege OR undefined_object THEN
        RAISE NOTICE 'execution-service: exec_queue grants skipped (no roles here); boundary rests on code.';
END
$$;

COMMIT;
