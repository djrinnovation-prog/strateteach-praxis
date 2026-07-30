-- Migration 019: public.operator_kill_all(text, boolean) — A8-H2 audited one-click kill
--
-- Purpose: a single audited, operator-gated, reversible "kill-all" the Operator Console
-- calls with one click. By default it DISABLES trading (bots.trading_enabled=false — the
-- worker's fail-closed gate before the adapter, worker/src/index.ts:860) AND PAUSES intake
-- (bots.status='paused' — the webhook reject, supabase/functions/webhook/index.ts:186-189).
-- Both paths are A10-proven (K1/K4). Design: docs/production-a8-h2-audited-one-click-kill-packet.md
-- (Codex PASS Rev 3). Plan: docs/production-a8-h2-implementation-plan.md (Codex PASS Rev 2).
--
-- What it does NOT do (by design): cancel already-submitted exchange orders, unwind positions,
-- stop the Railway worker, purge the pgmq queue, flip QUEUE_ENABLED, or invalidate any
-- credential / Vault secret. KP5 shared-credential blast-radius = A8-H3.
--
-- Auth: callable by the `authenticated` role via PostgREST with the operator's JWT; authorization
-- is enforced INSIDE the body (auth.uid() + profiles.is_operator), mirroring operator_status()
-- (migration 016). SECURITY DEFINER only so it can perform the privileged UPDATE + audit INSERT.
--
-- Audit: MANDATORY and in-transaction. The audit_logs INSERT runs before the final RETURN in the
-- same transaction; if it fails, the whole call rolls back (flags revert) — a kill is never
-- reported done unless audited. Denials (non-operator / null uid) raise BEFORE any write, so a
-- denial produces zero DB changes and zero audit rows.
--
-- Response contract (jsonb): { ok, kill_applied, requires_attention, operational_state,
-- enabled_bots_after, open_trades, queue_length, worker_state, worker_updated_at, audit_id,
-- message }. ok=true ONLY when clean: kill_applied AND open_trades=0 AND queue telemetry OK & 0
-- AND worker telemetry OK. open_trades>0 OR queue_length>0 => requires_attention=true, ok=false.
--
-- Telemetry vs core proof: `enabled_bots_after` is CORE PROOF — if it is not 0 the kill did not take
-- and the whole transaction RAISES/rolls back. `queue_length`, `worker_state`, `worker_updated_at`
-- are TELEMETRY — a read failure/missing row must NEVER roll back the kill; instead they come back
-- NULL, `queue_read_failed`/`worker_read_failed`=true, requires_attention=true, ATTENTION. A telemetry
-- glitch never produces "no kill happened".
--
-- Apply SURGICALLY (transaction-wrapped `supabase db query --linked --file`), NOT via `db push`,
-- and NOT recorded in supabase_migrations — consistent with the documented 010–018 migration-history
-- exception. The committed file is the record. GATED: apply LOCAL for tests (Slice 2); apply LINKED
-- only after CP1+CP2 PASS + explicit operator approval (Slice 5).

begin;

create or replace function public.operator_kill_all(
  p_reason    text    default null,
  p_hard_lock boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid                uuid;
  v_is_op              boolean;
  v_reason             text;
  v_before_bots        jsonb;
  v_enabled_before     integer;
  v_updated            integer := 0;
  v_paused             integer := 0;
  v_enabled_after      integer;
  v_open_trades        integer;
  v_queue              bigint;
  v_worker_state       text;
  v_worker_updated_at  timestamptz;
  v_queue_read_failed  boolean := false;
  v_worker_read_failed boolean := false;
  v_residual           boolean;   -- real operational residue: open trades or queued messages
  v_telemetry_incomplete boolean; -- queue/worker read-back failed (uncertainty, not known residue)
  v_kill_applied       boolean;
  v_requires_attention boolean;
  v_operational_state  text;
  v_ok                 boolean;
  v_message            text;
  v_before             jsonb;
  v_after              jsonb;
  v_audit_id           uuid;
begin
  -- 1. Authz gate (fail-closed) — mirror operator_status() (migration 016). Raises BEFORE any write.
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'operator_kill_all: not authenticated' using errcode = '42501';
  end if;

  select p.is_operator into v_is_op from public.profiles p where p.id = v_uid;
  if v_is_op is distinct from true then   -- NULL (no profile) OR false → forbidden
    raise exception 'operator_kill_all: forbidden' using errcode = '42501';
  end if;

  -- 2. Reason validation (BAD INPUT, not a permission denial). NULL/empty allowed; else trimmed,
  --    <= 500, single-line printable ASCII only (no tabs/newlines/control chars — keeps audit/log
  --    rendering sane). errcode 22023 = invalid_parameter_value (NOT 42501, which is auth denial).
  v_reason := btrim(p_reason);
  if v_reason is not null
     and (char_length(v_reason) > 500 or v_reason !~ '^[ -~]*$') then
    raise exception 'operator_kill_all: invalid reason (max 500 single-line printable chars)'
      using errcode = '22023';
  end if;

  -- 3. Capture BEFORE snapshot (status fields only — never secrets).
  select
    coalesce(jsonb_agg(jsonb_build_object(
              'id',              b.id,
              'trading_pair',    b.trading_pair,
              'trading_enabled', b.trading_enabled,
              'status',          b.status
            ) order by b.trading_pair), '[]'::jsonb),
    count(*) filter (where b.trading_enabled)
  into v_before_bots, v_enabled_before
  from public.bots b
  where b.deleted_at is null;

  -- 4. KILL (KP1, always): disable trading for all live, currently-enabled bots.
  update public.bots
     set trading_enabled = false
   where trading_enabled = true
     and deleted_at is null;
  get diagnostics v_updated = row_count;

  -- 5. HARD LOCK (KP4, default ON): pause intake for all live, currently-active bots.
  if p_hard_lock then
    update public.bots
       set status = 'paused'
     where status = 'active'
       and deleted_at is null;
    get diagnostics v_paused = row_count;
  end if;

  -- 6a. CORE PROOF read-back: enabled_bots_after MUST be 0. If the kill did not take, RAISE →
  --     the whole transaction rolls back (no misleading "kill applied" audit/response). This is the
  --     ONE read-back allowed to abort the kill. (errcode 40003 = statement_completion_unknown-ish
  --     internal failure; distinct from 42501 auth and 22023 bad-input.)
  select count(*) into v_enabled_after
    from public.bots where trading_enabled = true and deleted_at is null;
  if v_enabled_after <> 0 then
    raise exception 'operator_kill_all: kill did not take — % bot(s) still enabled', v_enabled_after
      using errcode = '40003';
  end if;
  v_kill_applied := true;

  select count(*) into v_open_trades
    from public.trades
   where status in ('pending', 'submitted', 'unknown') and deleted_at is null;

  -- 6b. TELEMETRY read-backs must NOT roll back the kill. A failure here = ATTENTION, not rollback.
  --     Each runs in its own subtransaction (BEGIN/EXCEPTION) so a failure is caught, not propagated.
  begin
    v_queue := public.pgmq_queue_length('trade_signals');
  exception when others then
    v_queue := null;
    v_queue_read_failed := true;
  end;

  begin
    select w.worker_state, w.updated_at
      into v_worker_state, v_worker_updated_at
      from public.worker_status w
     limit 1;
    if not found then
      v_worker_state := null;
      v_worker_updated_at := null;
      v_worker_read_failed := true;   -- missing row is also "telemetry unavailable" ⇒ ATTENTION
    end if;
  exception when others then
    v_worker_state := null;
    v_worker_updated_at := null;
    v_worker_read_failed := true;
  end;

  -- 7. Classify. Two DISTINCT reasons for ATTENTION:
  --    (a) RESIDUAL — real operational work exists: open trades or queued messages (queue known > 0).
  --    (b) TELEMETRY INCOMPLETE — queue/worker read-back failed, so cleanliness is UNCERTAIN.
  --    NOTE: worker_state VALUE (e.g. 'running') does NOT force ATTENTION — H2 kills bot flags, not the
  --    worker; only a worker TELEMETRY read failure/missing row (v_worker_read_failed) counts.
  v_residual             := (v_open_trades > 0) or (coalesce(v_queue, 0) > 0);
  v_telemetry_incomplete := v_queue_read_failed or v_worker_read_failed;
  v_requires_attention   := v_residual or v_telemetry_incomplete;
  v_operational_state    := case when v_requires_attention then 'ATTENTION' else 'SAFE' end;
  v_ok                   := (v_kill_applied and not v_requires_attention);

  if not v_requires_attention then
    v_message := 'Kill applied. Clean: no open trades, no queued messages'
                 || case when v_worker_state is not null then '; worker=' || v_worker_state else '' end || '.';
  else
    v_message := 'Kill applied (no new execution possible).'
                 -- (a) residual operational work
                 || case when v_residual then ' Residual operational work:'
                              || case when v_open_trades > 0
                                      then ' ' || v_open_trades || ' open trade(s) (not unwound by this action);'
                                      else '' end
                              || case when coalesce(v_queue, 0) > 0
                                      then ' ' || v_queue || ' queued message(s) (not purged by this action);'
                                      else '' end
                         else '' end
                 -- (b) telemetry uncertainty (kill applied, but cleanliness unverified)
                 || case when v_telemetry_incomplete then ' Telemetry incomplete (kill applied, cleanliness unverified):'
                              || case when v_queue_read_failed  then ' queue read-back failed;'  else '' end
                              || case when v_worker_read_failed then ' worker status unavailable;' else '' end
                         else '' end;
  end if;

  -- 8. Audit (MANDATORY, in-transaction). Failure here rolls back the whole call (flags revert).
  --    Status fields only; no token/pepper/hash/URL/credential/Vault id; no ip captured by this RPC.
  v_before := jsonb_build_object(
                'scope',        'all',
                'enabled_bots', v_enabled_before,
                'bots',         v_before_bots
              );
  v_after := jsonb_build_object(
               'enabled_bots_after',  v_enabled_after,
               'updated_rows',        v_updated,
               'paused_rows',         v_paused,
               'hard_lock',           p_hard_lock,
               'open_trades',         v_open_trades,
               'queue_length',        v_queue,             -- null when telemetry failed
               'queue_read_failed',   v_queue_read_failed,
               'worker_read_failed',  v_worker_read_failed,
               'reason',              v_reason,
               'kill_applied',        v_kill_applied,
               'requires_attention',  v_requires_attention,
               'operational_state',   v_operational_state
             );

  insert into public.audit_logs (entity_type, entity_id, event_type, before_state, after_state, actor_type, actor_id)
  values ('operator', v_uid, 'operator.kill_all', v_before, v_after, 'user', v_uid)
  returning id into v_audit_id;

  -- 9. Return the exact response contract.
  return jsonb_build_object(
    'ok',                 v_ok,
    'kill_applied',       v_kill_applied,
    'requires_attention', v_requires_attention,
    'operational_state',  v_operational_state,
    'enabled_bots_after', v_enabled_after,
    'open_trades',        v_open_trades,
    'queue_length',       v_queue,
    'worker_state',       v_worker_state,
    'worker_updated_at',  v_worker_updated_at,
    'audit_id',           v_audit_id,
    'message',            v_message
  );
end;
$$;

comment on function public.operator_kill_all(text, boolean) is
  'A8-H2 audited one-click kill. Operator-gated (auth.uid() + profiles.is_operator, inline like '
  'operator_status). Default hard_lock=true disables trading (trading_enabled=false) AND pauses intake '
  '(status=paused) for all live bots; writes a mandatory in-transaction audit_logs row '
  '(event operator.kill_all, actor=user). ok=true only when clean (no open trades / no queued messages); '
  'residual => requires_attention/ATTENTION/ok=false. Does NOT cancel orders, unwind, stop the worker, '
  'purge the queue, flip QUEUE_ENABLED, or invalidate credentials. No secrets in audit. KP5 = A8-H3.';

-- Lock down EXECUTE: revoke from everyone, grant only to authenticated (operator JWT; authz is in-body).
revoke all on function public.operator_kill_all(text, boolean) from public;
revoke all on function public.operator_kill_all(text, boolean) from anon;
grant execute on function public.operator_kill_all(text, boolean) to authenticated;

commit;
