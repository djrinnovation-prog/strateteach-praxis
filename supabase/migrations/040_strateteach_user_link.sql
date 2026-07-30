-- 040 — Phase 2C (Option A) · M2: StrateTeach→Praxis identity link + provisioning audit.
--
-- `strateteach_user_link` maps an OPAQUE, deterministic StrateTeach handle (`st_ref` = keyed HMAC of the
-- StrateTeach user's IMMUTABLE user_uid — never the recyclable username) to exactly one Praxis auth.users
-- identity. PK on st_ref + UNIQUE on praxis_user_id ⇒ exactly one identity per StrateTeach account, forever.
-- `status='disabled'` (set by a future deprovision) makes provision-user fail-closed (403), never re-link.
-- `provisioning_audit` is an append-only trail of every privileged provisioning event (no secrets).
--
-- Both tables are service_role-only: RLS ENABLED with NO policies ⇒ deny-all to anon/authenticated. Only
-- the Edge functions (service_role) touch them. Dormant until provision-user + the StrateTeach routes are
-- armed (PRAXIS_PROVISION_ENABLED, default off).

CREATE TABLE IF NOT EXISTS public.strateteach_user_link (
  st_ref          TEXT PRIMARY KEY,
  praxis_user_id  UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.strateteach_user_link IS
  'Phase 2C-A: st_ref (keyed HMAC of StrateTeach user_uid) -> one Praxis auth.users identity. Service-role only.';

CREATE TABLE IF NOT EXISTS public.provisioning_audit (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event           TEXT NOT NULL,                 -- provision | deprovision | approve_mainnet | arm | rotate | revoke
  praxis_user_id  UUID,
  praxis_bot_id   UUID,
  actor           TEXT,                          -- non-secret label of the acting authority
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta            JSONB                          -- non-secret only (fingerprints, status), NEVER keys
);

COMMENT ON TABLE public.provisioning_audit IS
  'Phase 2C-A: append-only audit of privileged provisioning events. No secrets/keys. Service-role only.';

ALTER TABLE public.strateteach_user_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provisioning_audit    ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: RLS-enabled + no policy already denies anon/authenticated; be explicit anyway since
-- these tables carry the identity mapping.
REVOKE ALL ON public.strateteach_user_link FROM anon, authenticated;
REVOKE ALL ON public.provisioning_audit    FROM anon, authenticated;

-- Reconcile helper for provision-user's self-heal path (createUser succeeded but the link insert crashed
-- before committing): fetch the auth.users id for our DETERMINISTIC synthetic email. service_role only.
-- HARDENED (audit): adopt a row ONLY if it is a GENUINE shadow user for THIS st_ref (source='strateteach'
-- AND st_ref match) — so a colliding or pre-seeded non-shadow signup on the synthetic email can never be
-- adopted as the identity. lower()-insensitive so an uppercase domain override can't wedge lookups.
DROP FUNCTION IF EXISTS public.auth_uid_by_email(TEXT);
CREATE OR REPLACE FUNCTION public.auth_uid_by_email(p_email TEXT, p_st_ref TEXT)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = auth, public AS $$
  SELECT id FROM auth.users
   WHERE lower(email) = lower(p_email)
     AND raw_user_meta_data->>'source' = 'strateteach'
     AND raw_user_meta_data->>'st_ref' = p_st_ref
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_uid_by_email(TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.auth_uid_by_email(TEXT, TEXT) TO service_role;
