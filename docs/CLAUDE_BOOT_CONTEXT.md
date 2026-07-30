# CLAUDE_BOOT_CONTEXT — v2.0.0
Last Verified: 2026-06-04 · against: Governance Model v1.0 (canonical) + Decision Log

## What this file is
The ONLY Claude Project memory file. It is a **bootstrap pointer**, not a source of
truth. It tells a cold session where to look and in what order. It contains no project
state, no runtime facts, and no decisions — those are fetched live from Notion.

If anything here conflicts with the canonical Notion docs, **the Notion docs win.**

## Authority rule (read before trusting anything)
- Source of truth = the canonical Notion docs (below) + Tier-1 runtime sources
  (Git SHA, Supabase migration history, Railway deploy state, Doppler, logs).
- Notion is narrative on top of truth. Runtime facts are NEVER trusted from a doc —
  only from the Tier-1 source. (Governance §0, §1)
- IGNORE any archived/legacy snapshot as a state source. Specifically:
  CURRENT_STATE, PRAXIS_RUNTIME_CONTEXT, LAST_SYNC, Sprints & Tasks DB,
  Execution Dashboard. If any of these are still attached to this Project,
  do NOT read them as state.
- A Tier-2 doc whose `Last Verified` predates the last gate close is suspect —
  verify against Tier-1 before acting.

## Boot read order (Governance §4 / §7.1)
1. Current Status        — where the build is right now
2. Decision Log (Active) — why things are the way they are
3. Open Incidents        — what is broken / unverified
4. Sprint Overview       — one-screen orientation
5. Targeted docs on demand — Architecture / Database Schema / Setup Guide
6. Tier-1 spot-check (only before acting on runtime facts): confirm Git SHA /
   Railway active deploy / migration head.

## Canonical docs (fetch live; do not cache facts here)
- ⚖️ Governance Model v1.0 — Canonical → https://app.notion.com/p/374d6df6026d817f8ea4f625ac2d4faf
- 🟢 Current Status (project state)       → https://app.notion.com/p/003a1611a9f048ba983dbe49a5141390
- ⚖️ Decision Log (the "why"; Active)     → https://app.notion.com/p/bc9d722bd4b74653bbe612a46d67498c
- Incidents (operational history)         → https://app.notion.com/p/4ea08480dd9c40e3b4aceab013368090
- 🗺️ Sprint Overview (derived mirror)      → https://app.notion.com/p/374d6df6026d81aab51afeb63ae813d7

## Memory Architecture v2 (Decision Log, 2026-06-04)
- Claude Project memory holds ONLY this pointer. It is NOT a backup/DR layer and is
  NEVER a source of truth.
- Disaster recovery lives OUTSIDE the LLM layer: scheduled Notion → Git/external
  exports, which are generated, dated, and non-authoritative.
- Decisions are read live from the Notion Decision Log. During a Notion outage,
  read the Git export `docs/DECISIONS.md` (non-authoritative) — not a Project file.
