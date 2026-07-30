-- 005_order_noop_qty.sql — honest zero-qty for orders that never executed.
--
-- Found by the slice-4 integration run on a real Postgres: the worker records
-- a DISARMED no-op / caps REJECTION as an exec_orders row (spec §4 — every
-- outcome is a record), and such a row honestly carries requested_qty = 0:
-- nothing was requested from any exchange. The 001 CHECK demanded qty > 0 for
-- EVERY row, so the no-op write itself crashed.
--
-- The strictness stays where it matters: any row that represents a real
-- (potential) execution still requires a positive quantity.

BEGIN;

ALTER TABLE exec_orders DROP CONSTRAINT IF EXISTS exec_orders_qty_positive;

ALTER TABLE exec_orders ADD CONSTRAINT exec_orders_qty_positive CHECK (
    requested_qty > 0 OR status IN ('noop_disarmed', 'rejected')
);

COMMIT;
