-- ============================================================
-- Migration: 004_vault_accessor_function.sql
-- Purpose:   Add get_decrypted_secret() wrapper for Vault access
-- Reason:    vault.decrypted_secrets VIEW is not exposed to PostgREST
--            (PGRST106). Worker accesses Vault via this function only.
--            Validated by spike-vault.ts (2026-05-31).
-- Security:  SECURITY DEFINER, service_role only.
--            anon + authenticated roles explicitly revoked.
-- ============================================================

CREATE OR REPLACE FUNCTION get_decrypted_secret(secret_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret_value text;
BEGIN
  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets
  WHERE id = secret_id;
  RETURN secret_value;
END;
$$;

-- service_role only — never anon or authenticated
REVOKE ALL ON FUNCTION get_decrypted_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_decrypted_secret(uuid) FROM anon;
REVOKE ALL ON FUNCTION get_decrypted_secret(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_decrypted_secret(uuid) TO service_role;
