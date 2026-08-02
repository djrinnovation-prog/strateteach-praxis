#!/usr/bin/env node
// mainnet-approve-user.mjs — generate the operator SQL that approves ONE user for mainnet.
// Mainnet Go-Live Plan v1.1 · 1.2 / Runbook Phase 3.3 (the per-user leg of the double-gate).
//
// Real-money-ENABLING action, so this script only PRINTS the SQL — it never touches the DB. The operator
// reviews the SQL and runs it via:  supabase db query --linked "<paste>"
// (The other leg is the GLOBAL switch PRAXIS_MAINNET_ENABLED=true; BOTH are required. And StrateTeach's
// users.praxis_env must also be 'mainnet' to mint a mainnet ticket.)
//
// Usage:
//   node scripts/mainnet-approve-user.mjs --user <praxis_user_uuid> --approver "<name>" --evidence "<ref/decision text>"
import crypto from 'node:crypto';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

const { user, approver, evidence } = parseArgs(process.argv.slice(2));
if (!user || !approver || !evidence) {
  console.error('Usage: node scripts/mainnet-approve-user.mjs --user <uuid> --approver "<name>" --evidence "<text>"');
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(user)) { console.error('--user must be a UUID (the Praxis auth.users id / praxis_user_id).'); process.exit(1); }

const evidence_hash = crypto.createHash('sha256').update(evidence).digest('hex'); // the evidence TEXT is never stored
const esc = (s) => String(s).replace(/'/g, "''");

console.log(`-- Mainnet approval for user ${user} — review, then run:  supabase db query --linked "<paste the INSERT>"`);
console.log(`-- evidence_hash = sha256(evidence); the evidence text itself is NOT stored.`);
console.log(`INSERT INTO public.mainnet_approvals (user_id, approved_by, evidence_hash, active)`);
console.log(`VALUES ('${user}', '${esc(approver)}', '${evidence_hash}', true)`);
console.log(`ON CONFLICT (user_id) DO UPDATE SET approved_by = EXCLUDED.approved_by, approved_at = now(), evidence_hash = EXCLUDED.evidence_hash, active = true;`);
console.log(`-- REVOKE this user's mainnet access at any time:`);
console.log(`-- UPDATE public.mainnet_approvals SET active = false WHERE user_id = '${user}';`);
