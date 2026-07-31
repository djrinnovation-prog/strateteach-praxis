#!/usr/bin/env node
// P4 deployed smoke test (TESTNET). Proves the DEPLOYED Praxis + worker end-to-end:
//   provision shadow user → create bot → connect testnet key → validate → arm → (optional) one filled trade.
//
// Mints provisioning tickets locally (like StrateTeach does) and hits the Praxis Edge functions through the
// public single-origin base. The exchange key is read from the ENV and POSTed straight to Praxis (→ Vault);
// it is NEVER printed and NEVER sent to StrateTeach. Run it yourself (operator) against the deployed env.
//
// Required env:
//   PRAXIS_FUNCTIONS_BASE   e.g. https://<app>.up.railway.app/pfn   (or https://<ref>.supabase.co/functions/v1)
//   PRAXIS_PROVISION_KEY_HEX  (or WEBHOOK_SECRET_PEPPER to derive it)
//   SMOKE_API_KEY / SMOKE_API_SECRET   your Binance TESTNET key/secret
// Optional:
//   SMOKE_PAIR (default BTCUSDT), SMOKE_NOTIONAL (default 11), SMOKE_ST_REF (default random 32B)
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  → also fire ONE testnet buy and verify it fills
//
//   PRAXIS_FUNCTIONS_BASE=... PRAXIS_PROVISION_KEY_HEX=... SMOKE_API_KEY=... SMOKE_API_SECRET=... \
//     node scripts/smoke-testnet.mjs
import crypto from 'node:crypto';

const BASE = (process.env.PRAXIS_FUNCTIONS_BASE || '').replace(/\/+$/, '');
const API_KEY = process.env.SMOKE_API_KEY || '';
const API_SECRET = process.env.SMOKE_API_SECRET || '';
const PAIR = (process.env.SMOKE_PAIR || 'BTCUSDT').toUpperCase();
const NOTIONAL = Number(process.env.SMOKE_NOTIONAL || '11');
const die = (m) => { console.error('SMOKE FAIL:', m); process.exit(1); };
if (!BASE) die('set PRAXIS_FUNCTIONS_BASE');
if (!API_KEY || !API_SECRET) die('set SMOKE_API_KEY / SMOKE_API_SECRET (testnet)');

let material;
if (process.env.PRAXIS_PROVISION_KEY_HEX) material = Buffer.from(process.env.PRAXIS_PROVISION_KEY_HEX.trim(), 'hex');
else if (process.env.WEBHOOK_SECRET_PEPPER)
  material = crypto.createHmac('sha256', Buffer.from(process.env.WEBHOOK_SECRET_PEPPER.trim(), 'base64url')).update('praxis.provision.ticket.v1').digest();
else die('set PRAXIS_PROVISION_KEY_HEX or WEBHOOK_SECRET_PEPPER');

const now = () => Math.floor(Date.now() / 1000);
const jti = () => crypto.randomBytes(12).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mint = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', material).update(body).digest('hex');
  return body + '.' + sig;
};
async function fn(name, body) {
  const r = await fetch(`${BASE}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch { /* non-json */ }
  return { status: r.status, d };
}

const stRef = process.env.SMOKE_ST_REF || crypto.randomBytes(32).toString('base64url');

(async () => {
  console.log(`→ base=${BASE} pair=${PAIR} notional=${NOTIONAL}`);

  // 1. provision shadow user
  const pu = await fn('provision-user', { ticket: mint({ action: 'provision_user', jti: jti(), exp: now() + 240, st_ref: stRef }) });
  const uid = pu.d.praxis_user_id || pu.d.user_id;
  if (pu.status >= 300 || !uid) die(`provision-user ${pu.status} ${JSON.stringify(pu.d)}`);
  console.log(`✓ provision-user → praxis_user_id=${String(uid).slice(0, 8)}…`);

  // 2. create bot
  const cb = await fn('create-bot', {
    ticket: mint({ praxis_user_id: uid, action: 'create_bot', jti: jti(), exp: now() + 240 }),
    trading_pair: PAIR, sizing_mode: 'fixed_notional', fixed_notional_usdt: NOTIONAL,
    max_order_notional_usdt: Math.max(NOTIONAL, 50), daily_notional_cap_usdt: 1000,
  });
  const botId = cb.d.bot_id;
  if (cb.status >= 300 || !botId) die(`create-bot ${cb.status} ${JSON.stringify(cb.d)}`);
  console.log(`✓ create-bot → bot_id=${botId}`);

  // 3. connect the TESTNET key — straight to Praxis Vault (key never printed / never to StrateTeach)
  const cc = await fn('connect-credential', {
    ticket: mint({ praxis_user_id: uid, action: 'connect_credential', jti: jti(), exp: now() + 240, praxis_bot_id: botId, exchange_ccxt_id: 'binance', env: 'testnet' }),
    api_key: API_KEY, api_secret: API_SECRET,
  });
  if (cc.status >= 300) die(`connect-credential ${cc.status} ${JSON.stringify(cc.d)}`);
  console.log('✓ connect-credential → key stored (pending_validation)');

  // 4. validate — worker fetchBalance auth-proof (read-only, never an order)
  const vc = await fn('validate-credential', { ticket: mint({ praxis_user_id: uid, action: 'validate_credential', jti: jti(), exp: now() + 240, praxis_bot_id: botId }) });
  if (vc.status >= 300) die(`validate-credential ${vc.status} ${JSON.stringify(vc.d)}`);
  console.log('✓ validate-credential → queued; polling status…');

  // 5. poll bot-status until the credential resolves
  let credStatus = 'pending_validation';
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const bs = await fn('bot-status', { ticket: mint({ praxis_user_id: uid, action: 'read_status', jti: jti(), exp: now() + 240 }) });
    const bot = (bs.d.bots || []).find((b) => b.id === botId);
    credStatus = bot?.credential_status ?? credStatus;
    if (credStatus && credStatus !== 'pending_validation') break;
  }
  console.log(`  credential_status = ${credStatus}`);
  if (credStatus !== 'valid') die(`key did not validate (status=${credStatus}) — check the key permissions/env`);

  // 6. arm
  const ab = await fn('arm-bot', { ticket: mint({ praxis_user_id: uid, action: 'arm_bot', jti: jti(), exp: now() + 240, praxis_bot_id: botId }) });
  if (ab.status >= 300 || ab.d.trading_enabled !== true) die(`arm-bot ${ab.status} ${JSON.stringify(ab.d)}`);
  console.log('✓ arm-bot → active');

  // 7. OPTIONAL: fire one testnet buy + verify it fills (needs the Praxis service role)
  const SB = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (SB && SR) {
    const signalId = `smoke-${now()}-${jti().slice(0, 6)}`;
    const enq = await fetch(`${SB.replace(/\/+$/, '')}/rest/v1/rpc/pgmq_send`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: SR, authorization: `Bearer ${SR}` },
      body: JSON.stringify({ queue_name: 'trade_signals', message: { schema_version: '1.0', bot_id: botId, signal_id: signalId, side: 'buy' } }),
    });
    if (!enq.ok) die(`enqueue signal ${enq.status}`);
    console.log(`✓ enqueued signal ${signalId}; polling trades…`);
    let trade = null;
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const q = await fetch(`${SB.replace(/\/+$/, '')}/rest/v1/trades?bot_id=eq.${botId}&signal_id=eq.${signalId}&select=status,exchange_order_id,executed_notional_usdt`, { headers: { apikey: SR, authorization: `Bearer ${SR}` } });
      const rows = await q.json().catch(() => []);
      trade = Array.isArray(rows) ? rows[0] : null;
      if (trade && (trade.status === 'filled' || trade.status === 'failed')) break;
    }
    if (!trade || trade.status !== 'filled') die(`trade did not fill: ${JSON.stringify(trade)}`);
    console.log(`✓ TRADE FILLED order_id=${trade.exchange_order_id} notional=${trade.executed_notional_usdt}`);
  } else {
    console.log('… trade step skipped (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to also fire one buy)');
  }

  console.log('\nSMOKE PASS ✓  (remember to KILL/clean up the test bot)');
})().catch((e) => die(e?.message || String(e)));
