-- 016_operator_status_verify.sql — verification for operator_status() + is_operator guard (S5 Slice 1b)
-- ============================================================================
-- Run AFTER migration 016 is applied, as a privileged session, to prove the required cases.
-- NON-DESTRUCTIVE: everything happens inside one transaction and is ROLLED BACK — no row persists.
-- (No SQL unit-test framework in this repo; SQL is verified at apply time per the 011/013/014 precedent.
--  This script is that verification, written as executable ASSERTs.)
--
-- auth.uid() simulation: depending on the Supabase helper, auth.uid() may read request.jwt.claims->>'sub'
-- OR request.jwt.claim.sub — so we set/clear BOTH (P2). One temp auth.users row is created (the 002
-- trigger auto-creates its profile, is_operator=false default), then flipped via a privileged update.
--
-- NOTE (apply-time): the auth.users INSERT column list is the common Supabase set; if the live instance
-- requires more NOT NULL columns, adjust ONLY that INSERT. Cases 1/2/6 do not depend on it. All rolled back.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_uid     uuid := gen_random_uuid();
  v_payload jsonb;
  v_blob    text;
  v_extra   integer;
BEGIN
  -- helper effect inline: set/clear both jwt settings via set_config(..., is_local => true)

  -- ── Case 6: no mutating operator_* RPC exists (only operator_status) ──────────────────────────
  SELECT count(*) INTO v_extra
  FROM pg_proc
  WHERE proname LIKE 'operator\_%' ESCAPE '\' AND proname <> 'operator_status';
  ASSERT v_extra = 0, 'FAIL case6: an unexpected operator_* function exists (no enable/pause/arm/fire RPC allowed)';

  -- ── Case 1: unauthorized (no auth.uid()) → denied (RAISE, not empty) ──────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.operator_status();
    RAISE EXCEPTION 'FAIL case1: unauthorized call was NOT denied';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

  -- ── Case 2: authenticated but no profile → denied ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.operator_status();
    RAISE EXCEPTION 'FAIL case2: no-profile call was NOT denied';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

  -- temp user (privileged context: clear claims so auth.uid() IS NULL) → 002 trigger creates profile
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'operator-status-verify@example.test', '', now(), now(), '{}'::jsonb, '{}'::jsonb);

  -- ── Case 3: profile exists, is_operator=false (default) → denied ──────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  BEGIN
    PERFORM public.operator_status();
    RAISE EXCEPTION 'FAIL case3: default is_operator=false was NOT denied';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

  -- ── Case 7: a USER context cannot self-assign is_operator (guard trigger) ─────────────────────
  -- claims still set to v_uid (auth.uid() = v_uid, a user context):
  BEGIN
    UPDATE public.profiles SET is_operator = true WHERE id = v_uid;
    RAISE EXCEPTION 'FAIL case7: is_operator self-assignment was NOT blocked';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;  -- expected: guard trigger raised
  ASSERT (SELECT is_operator FROM public.profiles WHERE id = v_uid) = false,
         'FAIL case7: is_operator changed despite the guard (raw read-back)';

  -- ── Case 4: operator (provisioned by a PRIVILEGED session) → non-null payload with expected keys ─
  PERFORM set_config('request.jwt.claims', '', true);          -- privileged: auth.uid() IS NULL
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.profiles SET is_operator = true WHERE id = v_uid;   -- guard ALLOWS (privileged)
  ASSERT (SELECT is_operator FROM public.profiles WHERE id = v_uid) = true,
         'FAIL case4: privileged provisioning did not set is_operator';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  v_payload := public.operator_status();
  ASSERT v_payload IS NOT NULL, 'FAIL case4: operator received NULL payload';
  ASSERT (v_payload ? 'bots') AND (v_payload ? 'enabled_bots') AND (v_payload ? 'open_trades')
     AND (v_payload ? 'dlq') AND (v_payload ? 'open_recon') AND (v_payload ? 'queue_length')
     AND (v_payload ? 'worker_status'),
     'FAIL case4: payload missing an expected key';

  -- ── Case 5: payload contains NO secret-like field ─────────────────────────────────────────────
  v_blob := lower(v_payload::text);
  ASSERT position('vault_secret_id' in v_blob) = 0
     AND position('service_role'    in v_blob) = 0
     AND position('secret'          in v_blob) = 0
     AND position('token'           in v_blob) = 0
     AND position('api_key'         in v_blob) = 0
     AND position('apikey'          in v_blob) = 0
     AND position('password'        in v_blob) = 0
     AND position('dsn'             in v_blob) = 0,
     'FAIL case5: payload contains a forbidden/secret-like field';

  RAISE NOTICE 'operator_status verify: ALL CASES PASS (1 unauthorized, 2 no-profile, 3 default-false denied; 7 self-assign blocked; 4 operator payload; 5 no secrets; 6 no mutation RPC)';
END $$;

ROLLBACK;
