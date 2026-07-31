#!/usr/bin/env node
// Derive PRAXIS_PROVISION_KEY_HEX from the Edge-only pepper.
//
// The StrateTeach backend mints provisioning tickets with this key; Praxis Edge derives the SAME key from
// WEBHOOK_SECRET_PEPPER, so the two agree without ever sharing the pepper. Run this ONCE (offline) and put
// the output in the StrateTeach backend env as PRAXIS_PROVISION_KEY_HEX.
//
// The pepper is read from the ENV (not a CLI arg) so it never lands in shell history:
//   WEBHOOK_SECRET_PEPPER='<base64url pepper>' node scripts/derive-provision-key.mjs
//
// Output is the key hex (treat as sensitive — it can mint tickets). Nothing else is printed.
import crypto from 'node:crypto';

const pepper = (process.env.WEBHOOK_SECRET_PEPPER || '').trim();
if (!pepper) {
  console.error('ERROR: set WEBHOOK_SECRET_PEPPER (base64url) in the environment first.');
  process.exit(2);
}
const material = crypto
  .createHmac('sha256', Buffer.from(pepper, 'base64url'))
  .update('praxis.provision.ticket.v1')
  .digest();
process.stdout.write(material.toString('hex') + '\n');
