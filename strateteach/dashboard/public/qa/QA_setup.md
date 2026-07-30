# QA Widget — setup & the mobile review loop

A tiny, dependency-free way to do UI/UX review from your phone and hand the results straight to
Claude/Cowork. No new backend required to start.

## 1. What it is

A floating **QA** button appears in the app (only for reviewers). You tap it, pick the screen you're
on, describe a fix, optionally attach a few screenshots, and hit **Add fix**. Each note is stamped
with the **screen name + route + a short #ID** so it's traceable. When you've collected a batch, tap
**Copy prompt** — the widget compiles every note into a **paste-ready Markdown task list** with a
"scan the screen first" instruction header, grouped by screen.

**The Markdown prompt IS the bridge.** There is no magic pipe: you paste that Markdown into your
Cowork/Claude chat, and Claude does the fixes. Everything else (storage, screenshots) is just there
to make writing that Markdown effortless from a phone.

## 2. Simplest version — zero backend

This is all you need to start:

- **`QaWidget.tsx`** (in this folder) — the whole widget, React-only, ~180 lines.
- **`localStorage`** — notes live in `localStorage["qa_notes"]`; nothing leaves the device.
- **Copy prompt** — builds the Markdown and copies it to the clipboard.

Wire it up:

1. Drop `QaWidget.tsx` into your app and render `<QaWidget/>` once near the root.
2. Enable it for yourself in the browser console: `localStorage.setItem("qa","1")` (and
   `localStorage.removeItem("qa")` to hide it). The button renders **only** when that gate is set.
3. Use it: **QA → Add fix (per screen) → Copy prompt → paste to Claude.**

That's the entire zero-backend loop. Screenshots are downscaled in the browser (max 900px, JPEG
< ~180KB each) so they stay small; the compiled prompt references how many images each note has.

## 3. Fuller version — server-backed inbox (optional, later)

When you want multiple reviewers, a shared inbox, saved report snapshots, and server-stored
screenshots, graduate to the pattern StrateTeach already runs. Roughly:

- **~7 backend endpoints**: `submit`, `list`, `delete`, `file-token` (short-lived token to fetch an
  uploaded screenshot), `report`, `report-send`, `snapshots` (save/restore a prompt batch).
- **3 Postgres tables**: `review_submissions`, `review_files`, `review_snapshots`.
- **Port the components**: StrateTeach's `ReviewMode.tsx` (the collector) + `ReviewInbox.tsx` (the
  multi-user inbox/report) + `review.py` (the endpoints) + those tables.

Same UX as the zero-backend widget, just shared + persistent server-side instead of `localStorage`.

## 4. The mobile-Cowork loop

The point of hosting this is that your phone's Cowork can't render chat attachments, but it can open
a URL and paste text. So:

1. Connect the new app's **repo to Cowork** so Claude can edit + deploy it.
2. Turn on **deploy-on-push** (commit to the deploy branch → it builds + ships).
3. Then the loop is:
   **phone → QA widget → Copy prompt → paste into Cowork chat → Claude fixes + deploys → reload.**

No Telegram, no attachments, no export step — the Markdown task list carries everything.

## 5. Gotchas

- **Gate hard.** The widget must render nothing for non-reviewers: check the gate and `return null`,
  but run **all hooks BEFORE the gate** (React rules of hooks — never return before a hook).
- **Portal to `<body>`** if you embed it inside a transformed/overflow-hidden container, so the
  floating button isn't clipped. (A standalone app doesn't need the portal.)
- **Downscale screenshots client-side** (canvas → JPEG, cap dimensions + file size) before storing —
  full-res phone photos will blow past `localStorage` limits fast.
- **#IDs are just hashes** for traceability (a 4-char base36 tag), not security. They only exist so a
  note in the Markdown can be pointed back to its screenshot/context.
- **No Telegram / no push needed.** The compiled Markdown is the entire hand-off; keep it that simple.
