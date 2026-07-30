-- Migration 039 (Phase 2B · M1): single-use ledger for connect-credential provisioning tickets.
--
-- The connect-credential Edge function claims a ticket's `jti` here (primary-key insert) BEFORE storing
-- the key, so a captured/replayed ticket cannot create a second credential (the second insert conflicts).
-- Tickets are also short-lived (exp), so this ledger only needs to outlive the freshness window; a
-- periodic cleanup of rows older than the window is safe (not included here). service_role only.

begin;

create table if not exists public.provision_tickets_used (
  jti      text primary key,
  used_at  timestamptz not null default now()
);

comment on table public.provision_tickets_used is
  'M1: single-use ledger of connect-credential provisioning-ticket jti values (replay prevention). '
  'service_role only; never exposed to anon/authenticated.';

alter table public.provision_tickets_used enable row level security;   -- deny-by-default (no policies)
revoke all on table public.provision_tickets_used from anon, authenticated, public;
grant select, insert on table public.provision_tickets_used to service_role;

commit;
