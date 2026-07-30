-- 003_distinct_approvers.sql — 3-of-3 means three DIFFERENT owners.
--
-- Review finding on slice 1 (2026-07-16): the 001 CHECK
-- (owner_approvals_three_of_three) counted APPROVALS (jsonb_array_length >= 3)
-- but not APPROVERS — the same owner pasted three times would satisfy it.
-- The spec's intent (§5) is unanimous consent of the three distinct owners.
--
-- This migration strengthens the gate at the database:
--   * a helper that counts DISTINCT, non-empty, case/space-normalised "owner"
--     keys in the approvals array;
--   * the CHECK is replaced: approved/executed now requires
--     >= 3 approvals AND >= 3 distinct approvers.
-- Fail-closed: malformed entries (no "owner" key, empty string) do not count.

BEGIN;

-- IMMUTABLE so it is legal inside a CHECK constraint: it reads only its input.
CREATE OR REPLACE FUNCTION owner_approvals_distinct_approvers(approvals JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COUNT(DISTINCT LOWER(TRIM(elem->>'owner')))::integer
      FROM jsonb_array_elements(approvals) AS elem
     WHERE COALESCE(TRIM(elem->>'owner'), '') <> '';
$$;

ALTER TABLE owner_approvals
    DROP CONSTRAINT IF EXISTS owner_approvals_three_of_three;

ALTER TABLE owner_approvals
    ADD CONSTRAINT owner_approvals_three_of_three CHECK (
        status NOT IN ('approved', 'executed')
        OR (
            jsonb_array_length(approvals) >= 3
            AND owner_approvals_distinct_approvers(approvals) >= 3
        )
    );

COMMENT ON FUNCTION owner_approvals_distinct_approvers(JSONB) IS
    '3-of-3 helper: DISTINCT non-empty approvals[].owner (normalised). Same owner x3 = 1.';

COMMIT;
