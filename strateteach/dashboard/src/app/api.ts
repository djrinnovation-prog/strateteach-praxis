import { Api, type ExchangeCreds } from "../lib/client";

// Single-origin: empty base => relative URLs, proxied to the backend by Caddy.
// VITE_API_BASE can override for local `npm run dev` against a remote backend.
export const api = new Api((import.meta as any).env?.VITE_API_BASE || "");

const TOKEN_KEY = "algo770_token";
const EX_KEY = "algo770_exchange_creds"; // non-custodial: keys live only in this browser

const stored = localStorage.getItem(TOKEN_KEY);
if (stored) api.setToken(stored);

export function saveToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  api.setToken(token);
  // A token change = a new session (login OR logout). Re-arm the one-shot server-side
  // creds restore so the NEXT authenticated user gets their own encrypted backup pulled.
  _restoreTried = false;
}

export const hasToken = () => !!localStorage.getItem(TOKEN_KEY);

// Current user's role — set after login so shared components (e.g. ExportBar) can
// show admin-only controls without prop threading.
let _role = "";
export function setRole(role: string | null | undefined) { _role = role || ""; }
export function isAdmin() { return _role === "admin"; }

// DEPRECATED single "main admin" tier — removed. The three OWNERS (Dan/Rafi/Yoav) are
// equal and hold every former main-admin power; there is no super-admin above them. Kept
// only so `setMain` still consumes /auth/me's `isMain`; NO gate should use isMainAdmin()
// anymore — use isOwner() (owner-only) or isAdminOrOwner() (owner||admin surfaces).
let _main = false;
export function setMain(isMain: boolean | null | undefined) { _main = !!isMain; }
export function isMainAdmin() { return _owner; }  // legacy alias → owner (all 3 equal)

// Product OWNER (Dan / Rafi / Yoav) — EQUAL top tier, server-decided (owner allowlist /
// owner_flag), set from /auth/me's `isOwner`. Full access: every admin function + Owners
// Portal + Finance + all former main-admin powers (role grants, PIN reset, maintenance…).
let _owner = false;
export function setOwner(isOwner: boolean | null | undefined) { _owner = !!isOwner; }
export function isOwner() { return _owner; }

// ADMIN-tier surfaces (user mgmt, system, bots, comms, monitoring) = a product OWNER OR a
// role=='admin' user (Oren). Owners pass every admin function even if not role=='admin'.
export function isAdminOrOwner() { return _owner || _role === "admin"; }

// Legal-editor flag — gates the in-app Legal Console (main admin OR granted by the main
// admin). Set from /auth/me's `isLegalEditor`.
let _legalEditor = false;
export function setLegalEditor(v: boolean | null | undefined) { _legalEditor = !!v; }
export function isLegalEditor() { return _legalEditor; }

// Legal-COPY writer — stricter than isLegalEditor: only Raz (legal_editor) or the main
// admin may EDIT/APPROVE the 4 legal-copy blocks; other owners are read-only. Set from
// /auth/me's `isLegalCopyWriter`.
let _legalCopyWriter = false;
export function setLegalCopyWriter(v: boolean | null | undefined) { _legalCopyWriter = !!v; }
export function isLegalCopyWriter() { return _legalCopyWriter; }

// IT-editor flag — gates the IT portal (Oren). An owner always qualifies, plus a per-user
// it_editor grant. Mirrors the legal-editor flag. Set from /auth/me's `isItEditor`.
let _itEditor = false;
export function setItEditor(v: boolean | null | undefined) { _itEditor = !!v; }
export function isItEditor() { return _itEditor; }

// "Full viewer" tier — Dan's rule for Oren: sees EVERY screen + the Owners-Portal VIEWS +
// the QA tool, like an owner, but WITHOUT finances. Currently = product owners + the IT editor
// (Oren). Finance stays STRICTLY isOwner() everywhere (the FinancePanel / Employees / owner
// reports / require_owner endpoints), so a full-viewer never sees money. Legal/Biz editors are
// deliberately NOT here — they stay portal-restricted to their own workspace.
export function isFullViewer() { return _owner || _itEditor; }

// Biz-editor flag — gates the Business Development portal (Raful). An owner always
// qualifies, plus a per-user biz_editor grant. Mirrors the IT-editor flag. Set from
// /auth/me's `isBizEditor`.
let _bizEditor = false;
export function setBizEditor(v: boolean | null | undefined) { _bizEditor = !!v; }
export function isBizEditor() { return _bizEditor; }

// Review-tool audience — the OWNERS (Dan/Rafi/Yoav), any role=='admin' user (e.g. Oren once
// promoted), + the portal collaborators: Oren (it_editor), Raz (legal_editor), Raful (biz_editor).
// Mirrors the backend's require_reviewer gate so the QA button's visibility matches exactly what
// the /auth/review/* endpoints authorize.
export function isReviewer() { return _owner || isAdmin() || _itEditor || _legalEditor || _bizEditor; }

// Content-editor flag — gates the content editors (Reels; Courses next). Any full admin
// qualifies, plus a per-user content_editor grant. Set from /auth/me's `isContentEditor`.
let _contentEditor = false;
export function setContentEditor(v: boolean | null | undefined) { _contentEditor = !!v; }
export function isContentEditor() { return _contentEditor; }

// ── Exchange keys: the BROWSER remains the fast path (per-device localStorage), PLUS
// an OPT-IN, ENCRYPTED-AT-REST server backup so the connection follows the user across
// devices and survives a site-data clear. The plaintext keys are pushed over HTTPS and
// stored server-side ONLY as Fernet ciphertext (see python-backend exchange creds-backup
// endpoints); they are decrypted back ONLY to the authenticated owner. ──
export function loadExchangeCreds(): ExchangeCreds | null {
  try { const raw = localStorage.getItem(EX_KEY); return raw ? JSON.parse(raw) as ExchangeCreds : null; }
  catch { return null; }
}
export function saveExchangeCreds(creds: ExchangeCreds | null) {
  if (creds && (creds.key || creds.secret)) localStorage.setItem(EX_KEY, JSON.stringify(creds));
  else localStorage.removeItem(EX_KEY);
  api.setExchangeCreds(creds);
  emitExchangeChanged();
  syncExchangeBackup(creds);
}

// A stable signature of the active connection — so we only PUSH the encrypted backup
// when the keys actually CHANGE (an explicit connect / edit / disconnect), never on a
// plain boot/refresh mirror. Seeded from whatever is already in this browser at load,
// so an existing-connected device does NOT re-push (and thus can't clobber a newer
// backup another device wrote) just by reloading.
function credsSig(c: ExchangeCreds | null): string {
  return c && c.key && c.secret ? [c.name || "", c.env || "", c.key, c.secret, c.passphrase || ""].join("|") : "";
}
let _lastBackupSig = credsSig(loadExchangeCreds());
// One-shot guard so we restore-from-server at most once per session (re-armed on login/
// logout via saveToken). Prevents a GET storm when a user simply has no backup stored.
let _restoreTried = false;

// Push (or clear) the server-side encrypted backup for the CURRENTLY ACTIVE connection.
// Fire-and-forget, best-effort: a failed backup never blocks the local (fast-path) save.
function syncExchangeBackup(creds: ExchangeCreds | null) {
  if (!hasToken()) return;                 // only for a logged-in user
  const sig = credsSig(creds);
  if (sig === _lastBackupSig) return;      // unchanged since last sync/boot → nothing to do
  _lastBackupSig = sig;
  try {
    if (sig) {
      api.saveExchangeBackup({ name: creds!.name, env: creds!.env, key: creds!.key!, secret: creds!.secret!, passphrase: creds!.passphrase }).catch(() => { /* best-effort */ });
    } else {
      // Empty signature = explicit disconnect → remove the server backup too.
      api.deleteExchangeBackup().catch(() => { /* best-effort */ });
    }
  } catch { /* never let backup sync throw into the caller */ }
}

// Restore the connection from the ENCRYPTED server backup when this device has no local
// copy (fresh device / after a cache-clear). The local per-device copy stays the fast
// path — this only fills the gap when it's absent. Populates EX_KEY + the accounts store
// so the whole app sees the connection, WITHOUT re-pushing what we just read back.
export async function restoreExchangeCredsFromServer(): Promise<boolean> {
  if (_restoreTried) return false;
  _restoreTried = true;
  if (!hasToken()) return false;
  if (loadExchangeCreds()) return false;   // local fast-path already present → nothing to restore
  try {
    const res = await api.getExchangeBackup();
    const c = res?.hasBackup ? res.creds : undefined;
    if (!c || !c.key || !c.secret) return false;
    const creds: ExchangeCreds = { key: c.key, secret: c.secret, passphrase: c.passphrase || "", name: c.name, env: c.env };
    _lastBackupSig = credsSig(creds);        // mark as already-in-sync so we don't push it straight back
    localStorage.setItem(EX_KEY, JSON.stringify(creds));
    api.setExchangeCreds(creds);
    // Seed a multi-account entry so the accounts UI shows the restored connection.
    if (loadAccounts().length === 0) {
      const label = (creds.name ? `${creds.name}` : "Account 1") + (creds.env === "live" ? " · LIVE" : creds.env === "testnet" ? " · TEST" : "");
      const a: Account = { id: "acc1", label, ...creds };
      saveAccounts([a]);
      localStorage.setItem(ACTIVE_KEY, a.id);
    }
    emitExchangeChanged();
    return true;
  } catch { return false; }
}
// Fired whenever the in-browser connection (EX_KEY / active account) changes, so the
// safety "reconnect" banner can re-evaluate without polling. Same-tab localStorage
// edits don't fire the native `storage` event, so we emit our own.
function emitExchangeChanged() { try { window.dispatchEvent(new Event("algo770-exchange-changed")); } catch { /* SSR / no window */ } }
// ── Multi-account (sub-accounts): up to 20 per user, unlimited for admins ──
// Each account is a named set of non-custodial keys, stored only in this browser.
// The "active" account is mirrored into EX_KEY so all existing single-account
// code (loadExchangeCreds / api.setExchangeCreds) keeps working unchanged.
export type Account = ExchangeCreds & { id: string; label: string; createdAt?: string };
const ACCTS_KEY = "algo770_exchange_accounts";
const ACTIVE_KEY = "algo770_exchange_active";
export const ACCOUNT_LIMIT = 20;

function readAccts(): Account[] {
  try { const raw = localStorage.getItem(ACCTS_KEY); const l = raw ? JSON.parse(raw) : []; return Array.isArray(l) ? l : []; }
  catch { return []; }
}
export function loadAccounts(): Account[] {
  let list = readAccts();
  if (list.length === 0) {
    const legacy = loadExchangeCreds();
    if (legacy && (legacy.key || legacy.secret)) {
      const a: Account = { id: "acc1", label: (legacy.name ? `${legacy.name}` : "Account 1") + (legacy.env === "live" ? " · LIVE" : legacy.env === "testnet" ? " · TEST" : ""), ...legacy };
      list = [a];
      try { localStorage.setItem(ACCTS_KEY, JSON.stringify(list)); localStorage.setItem(ACTIVE_KEY, a.id); } catch { /* */ }
    }
  }
  return list;
}
export function saveAccounts(list: Account[]) { try { localStorage.setItem(ACCTS_KEY, JSON.stringify(list)); } catch { /* */ } }
export function activeAccountId(): string | null { return localStorage.getItem(ACTIVE_KEY); }
export function activeAccount(): Account | null {
  const list = loadAccounts(); const id = activeAccountId();
  return list.find((a) => a.id === id) || list[0] || null;
}
function mirrorActive() {
  const a = activeAccount();
  const creds: ExchangeCreds | null = a ? { key: a.key, secret: a.secret, passphrase: a.passphrase, name: a.name, env: a.env } : null;
  if (creds && (creds.key || creds.secret)) {
    // An active account WITH keys resolved → mirror it into the single-creds slot.
    localStorage.setItem(EX_KEY, JSON.stringify(creds));
    api.setExchangeCreds(creds);
    // Back up the now-active connection (encrypted, server-side). No-op unless the keys
    // actually changed vs. the last sync — so switching/booting doesn't re-push.
    syncExchangeBackup(creds);
  } else {
    // NO active account with keys could be resolved — a null / empty / transient
    // state (boot before the active pointer is restored, an account row without
    // keys, a mid-switch race). NEVER destroy the stored non-custodial connection
    // here: wiping EX_KEY must happen ONLY through an explicit user delete
    // (saveExchangeCreds(null) / removeAccount). Keep whatever is already stored so
    // a reload / re-boot / new deploy stays connected instead of silently clearing.
    api.setExchangeCreds(loadExchangeCreds());
  }
  emitExchangeChanged();
}
export function setActiveAccount(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY);
  mirrorActive();
}
export function addAccount(acct: Omit<Account, "id">): Account {
  const list = loadAccounts();
  const id = "acc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const a: Account = { id, ...acct, createdAt: acct.createdAt || new Date().toISOString() };
  list.push(a); saveAccounts(list);
  setActiveAccount(id);
  return a;
}
export function removeAccount(id: string) {
  const list = loadAccounts().filter((a) => a.id !== id);
  saveAccounts(list);
  if (list.length === 0) {
    // User EXPLICITLY removed their LAST account → clear the connection for real.
    // mirrorActive() no longer clears EX_KEY, and loadAccounts() would otherwise
    // resurrect this account from the legacy EX_KEY mirror, so clear both here. This
    // is the only auto-path (besides saveExchangeCreds(null)) allowed to wipe keys.
    localStorage.removeItem(ACTIVE_KEY);
    saveExchangeCreds(null);
  } else if (activeAccountId() === id) {
    setActiveAccount(list[0].id);
  }
}

// Restore on startup so exchange calls are authenticated from the first render.
// (loadAccounts migrates a legacy single account into the store, then we mirror
// the active one back into the single-creds slot.)
loadAccounts();
if (activeAccountId()) mirrorActive(); else api.setExchangeCreds(loadExchangeCreds());
// If this device has a token but NO local exchange creds (fresh device / after a
// cache-clear), pull the encrypted backup so the user stays connected. App.tsx also
// calls this after a fresh login; the one-shot guard makes the duplicate a no-op.
if (hasToken() && !loadExchangeCreds()) { void restoreExchangeCredsFromServer(); }
