-- Migration 031: create_vault_secret() — Vault WRITE wrapper (mirrors 004 read / 005 delete).
-- SECURITY DEFINER, service_role ONLY. Returns the new vault_secret_id (uuid). Never logs the secret.
-- Used by operator provisioning + the future connect-exchange Edge fn to store an exchange key in Vault so
-- the DB holds only the pointer (vault_secret_id). Apply SURGICALLY (db query --linked --file), NEVER db push.
-- GATED: apply LOCAL for tests first; apply LINKED only on explicit operator approval + read-back; then
-- record 031 in schema_migrations.

create or replace function public.create_vault_secret(
  secret_value       text,
  secret_name        text,
  secret_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- vault.create_secret(new_secret, new_name, new_description) returns the new secret's uuid.
  -- The plaintext is written straight into Vault; it is NEVER logged or returned by this function.
  select vault.create_secret(secret_value, secret_name, secret_description) into v_id;
  return v_id;
end;
$$;

-- service_role only — never anon/authenticated/PUBLIC (mirrors 004/005).
revoke all on function public.create_vault_secret(text, text, text) from public;
revoke all on function public.create_vault_secret(text, text, text) from anon;
revoke all on function public.create_vault_secret(text, text, text) from authenticated;
grant execute on function public.create_vault_secret(text, text, text) to service_role;
