import { useEffect, useState } from "react";
import { api, hasToken } from "../app/api";
import type { LayoutArrangement, LayoutResolved, LayoutScope } from "./client";

// ── Layout / location editor — shared client logic ───────────────────────────
// TileGrid + ScreenShortcuts both render a RESOLVED arrangement (which buttons
// show + their order) that the layout editor writes. The server is the source of
// truth (a user's picks follow them across devices; owners set a default/role
// layout for everyone), with localStorage as an offline fallback + a no-flicker
// fast path on boot.
//
// MONEY-SAFETY: `applyArrangement` ALWAYS keeps a `locked` id in the shown set,
// regardless of a stored hidden[]. Safety-critical controls therefore can never
// be suppressed by an arrangement — not via the editor and not via a hand-forged
// server row. The editor UI additionally disables hiding a locked item.

export type { LayoutArrangement, LayoutScope } from "./client";

const EMPTY: LayoutArrangement = { order: [], hidden: [] };

// ── localStorage (offline fallback + fast path) ──
const lsKey = (screenKey: string) => `algo770_layout_${screenKey}_v2`;

export function readLocal(screenKey: string): LayoutArrangement | null {
  try {
    const raw = localStorage.getItem(lsKey(screenKey));
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (a && Array.isArray(a.order) && Array.isArray(a.hidden)) {
      return { order: a.order.filter((x: unknown) => typeof x === "string"), hidden: a.hidden.filter((x: unknown) => typeof x === "string") };
    }
  } catch { /* ignore */ }
  return null;
}

export function writeLocal(screenKey: string, arr: LayoutArrangement | null) {
  try {
    if (arr) localStorage.setItem(lsKey(screenKey), JSON.stringify(arr));
    else localStorage.removeItem(lsKey(screenKey));
  } catch { /* ignore */ }
}

// ── Legacy migration (pre-editor localStorage keys) ──
// The old TileGrid stored a bare order array under `algo770_tilelayout_<k>_v1`;
// the old ScreenShortcuts stored the chosen keys under `algo770_shortcuts_<k>_v1`.
// Consumers fold these into their code-default when no server/v2 arrangement exists,
// so a user who already customised doesn't lose their picks on first load.
export function legacyTileOrder(screenKey: string): string[] {
  try {
    const raw = localStorage.getItem(`algo770_tilelayout_${screenKey}_v1`);
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a.filter((x) => typeof x === "string"); }
  } catch { /* ignore */ }
  return [];
}
export function legacyShortcutKeys(screenKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(`algo770_shortcuts_${screenKey}_v1`);
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a.filter((x) => typeof x === "string"); }
  } catch { /* ignore */ }
  return null;
}

// ── The pure render-time resolver ──
// Orders `items` by `arr.order` (unknown ids keep their code order, after the
// known ones), then drops hidden ids — EXCEPT locked ids, which are always kept.
// With `maxShown` (the shortcuts row's 5-slot cap) it keeps every locked item plus
// non-locked items up to the cap, preserving order.
export function applyArrangement<T extends { id: string }>(
  items: T[],
  arr: LayoutArrangement | null | undefined,
  opts: { lockedIds?: string[]; maxShown?: number } = {},
): { shown: T[]; ordered: T[] } {
  const order = arr?.order ?? [];
  const hidden = new Set(arr?.hidden ?? []);
  const locked = new Set(opts.lockedIds ?? []);
  const idx = new Map(items.map((it, i) => [it.id, i] as const));   // stable tiebreak
  const ordered = [...items].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    const ra = ia === -1 ? 1e9 + (idx.get(a.id) ?? 0) : ia;
    const rb = ib === -1 ? 1e9 + (idx.get(b.id) ?? 0) : ib;
    return ra - rb;
  });
  let shown = ordered.filter((it) => locked.has(it.id) || !hidden.has(it.id));
  if (opts.maxShown != null) {
    const cap = opts.maxShown;
    let n = 0;
    const out: T[] = [];
    for (const it of shown) {
      if (locked.has(it.id)) { out.push(it); continue; }   // locked never counts against / is never cut by the cap
      if (n < cap) { out.push(it); n += 1; }
    }
    shown = out;
  }
  return { shown, ordered };
}

// ── Session cache so re-mounts don't refetch / flicker ──
type State = { arr: LayoutArrangement | null; source: LayoutResolved["source"]; canEditShared: boolean; role: string | null };
const cache = new Map<string, State>();
const inflight = new Map<string, Promise<void>>();
// Fired after a save so other mounted consumers of the same screenKey refresh.
const CHANGED = "algo770-layout-changed";

function initial(screenKey: string): State {
  const c = cache.get(screenKey);
  if (c) return c;
  return { arr: readLocal(screenKey), source: "code", canEditShared: false, role: null };
}

export type UseLayout = State & {
  loaded: boolean;
  save: (arr: LayoutArrangement, scope: LayoutScope) => Promise<void>;
  // Clears the given scope's stored arrangement and returns the freshly RESOLVED
  // arrangement it falls back to (role/default/user override, or null = code order),
  // so an open editor can re-seed to reflect the revert.
  reset: (scope: LayoutScope) => Promise<LayoutArrangement | null>;
};

export function useLayout(screenKey: string): UseLayout {
  const [state, setState] = useState<State>(() => initial(screenKey));
  const [loaded, setLoaded] = useState<boolean>(() => cache.has(screenKey));

  useEffect(() => {
    let alive = true;
    const apply = (s: State) => { if (alive) { setState(s); setLoaded(true); } };
    // Re-read from cache on mount (another consumer may have loaded it since).
    if (cache.has(screenKey)) apply(cache.get(screenKey)!);

    if (hasToken() && !cache.has(screenKey)) {
      let p = inflight.get(screenKey);
      if (!p) {
        p = api.layoutGet(screenKey).then((r) => {
          const s: State = { arr: r.arrangement, source: r.source, canEditShared: !!r.canEditShared, role: r.role ?? null };
          cache.set(screenKey, s);
          if (r.arrangement) writeLocal(screenKey, r.arrangement);
        }).catch(() => { /* offline / gated → keep localStorage fallback */ })
          .finally(() => { inflight.delete(screenKey); });
        inflight.set(screenKey, p);
      }
      p.then(() => { if (cache.has(screenKey)) apply(cache.get(screenKey)!); else if (alive) setLoaded(true); });
    }

    const onChanged = (e: Event) => {
      if ((e as CustomEvent).detail === screenKey && cache.has(screenKey)) apply(cache.get(screenKey)!);
    };
    window.addEventListener(CHANGED, onChanged as EventListener);
    return () => { alive = false; window.removeEventListener(CHANGED, onChanged as EventListener); };
  }, [screenKey]);

  async function save(arr: LayoutArrangement, scope: LayoutScope) {
    // Optimistic: a personal (user) save updates this device immediately; a shared
    // (owner) save only changes THIS user's view if it's what resolves for them, so
    // we re-fetch after to pull the authoritative resolved arrangement.
    if (scope === "user") {
      const next: State = { ...(cache.get(screenKey) ?? initial(screenKey)), arr, source: "user" };
      cache.set(screenKey, next); writeLocal(screenKey, arr); setState(next); setLoaded(true);
      broadcast(screenKey);
    }
    try {
      const r = await api.layoutSave(screenKey, scope, arr);
      const next: State = { ...(cache.get(screenKey) ?? initial(screenKey)), arr: r.arrangement, source: (r.source as State["source"]) || "user" };
      cache.set(screenKey, next); if (r.arrangement) writeLocal(screenKey, r.arrangement);
      setState(next); broadcast(screenKey);
    } catch { /* best-effort — the optimistic local write already applied for user scope */ }
  }

  async function reset(scope: LayoutScope) {
    try {
      const r = await api.layoutReset(screenKey, scope);
      const next: State = { ...(cache.get(screenKey) ?? initial(screenKey)), arr: r.arrangement, source: (r.source as State["source"]) || "code" };
      cache.set(screenKey, next);
      if (scope === "user") writeLocal(screenKey, r.arrangement ?? null);
      setState(next); broadcast(screenKey);
      return r.arrangement ?? null;
    } catch { return (cache.get(screenKey) ?? initial(screenKey)).arr; }
  }

  return { ...state, loaded, save, reset };
}

function broadcast(screenKey: string) {
  try { window.dispatchEvent(new CustomEvent(CHANGED, { detail: screenKey })); } catch { /* SSR/no-window */ }
}
