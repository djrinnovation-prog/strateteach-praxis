-- Migration 005: Vault delete function
-- Purpose: Allows Worker to delete a Vault secret during key rotation or
--          when a user disconnects their exchange account.
--
-- Security model (matches migration 004):
--   - SECURITY DEFINER: runs with owner privileges, not caller's
--   - SET search_path = '': prevents search_path injection attacks
--   - Only service_role has EXECUTE permission
--   - anon, authenticated, and PUBLIC are explicitly revoked
--
-- Usage (Worker, Node.js):
--   const { data, error } = await supabase.rpc('delete_vault_secret', {
--     secret_id: vaultSecretId  -- uuid
--   })
--   // data = true  → secret deleted
--   // data = false → secret not found (already deleted or wrong id)
--
-- Key rotation order (CRITICAL — never reverse):
--   1. INSERT new secret into Vault → get new_vault_secret_id
--   2. UPDATE user_exchange_credentials.vault_secret_id = new_vault_secret_id  ← atomic
--   3. DELETE old Vault secret via this function
--
--   Step 2 must complete before step 3.
--   If step 3 fails: old secret remains in Vault (orphaned but harmless).
--   If step 2 fails: new secret is orphaned — delete it, abort rotation.
--   Never delete before update — that creates a window where DB points to nothing.

CREATE OR REPLACE FUNCTION delete_vault_secret(secret_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM vault.secrets WHERE id = secret_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

-- Revoke from all default roles
REVOKE ALL ON FUNCTION delete_vault_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_vault_secret(uuid) FROM anon;
REVOKE ALL ON FUNCTION delete_vault_secret(uuid) FROM authenticated;

-- Grant only to service_role (Worker)
GRANT EXECUTE ON FUNCTION delete_vault_secret(uuid) TO service_role;
