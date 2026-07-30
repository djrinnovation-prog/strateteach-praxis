-- wb6-e1-status.sql — WB6 E1 read-only status. Safe: no writes, no secrets.
--
-- Quick summary (CLI):   supabase db query --linked --file sql/wb6-e1-status.sql
--   NOTE: `db query --file` returns only the LAST statement's result, so the SUMMARY
--   below is placed last-among-summaries via a single row. For the DETAIL sections,
--   paste this file into the Supabase SQL Editor (shows every result grid).
--
-- Bot under test: 2dcaddba-b62d-47e1-87a7-7f7b759f38d2

-- === DETAIL (Supabase SQL Editor) ===
select signal_id, status, rejection_reason, source_ip, received_at
from public.webhook_logs
where bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
order by received_at desc limit 5;

select id, signal_id, side, trading_pair, quantity, status, exchange_order_id,
       price_at_execution, error_reason, created_at, filled_at
from public.trades
order by created_at desc limit 5;

select entity_type, entity_id, event_type, after_state, created_at
from public.audit_logs
order by created_at desc limit 8;

select trade_id, bot_id, signal_id, failure_reason, retry_count, created_at
from public.trades_dlq
order by created_at desc limit 5;

select trade_id, status, resolution, notes, created_at
from public.reconciliation_jobs
order by created_at desc limit 5;

select bot_id, event_type, actor, metadata, created_at
from public.bot_events
where bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
order by created_at desc limit 5;

-- === SUMMARY (one row — also the result returned by `db query --file`) ===
select
  (select queue_length from pgmq.metrics('trade_signals'))                                                    as queue_length,
  (select status from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                            as bot_status,
  (select credential_id is not null from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')         as cred_attached,
  (select count(*) from public.webhook_logs where bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')             as webhook_logs,
  (select count(*) from public.trades)                                                                        as trades,
  (select count(*) from public.trades_dlq)                                                                    as dlq,
  (select count(*) from public.reconciliation_jobs)                                                           as recon,
  (select count(*) from public.bot_events where bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')               as bot_events,
  (select count(*) from public.audit_logs)                                                                    as audit_logs;
