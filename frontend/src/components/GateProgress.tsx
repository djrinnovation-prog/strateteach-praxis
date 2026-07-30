// GateProgress.tsx — read-only production-readiness gate indicator (UI-1).
// Shows the mainnet-activation gates and their status. Informational only: it renders no controls and
// performs no action. Data is injected (default reflects current known state) so it never fabricates a
// success — a gate is 'pending' unless explicitly marked complete.

export type GateState = 'complete' | 'pending'

export interface Gate {
  id: string
  name: string
  state: GateState
  note: string
}

/** Current known gate state. Mainnet activation stays locked until every gate is 'complete'. */
export const DEFAULT_GATES: Gate[] = [
  { id: 'A1', name: 'A1 — Static egress / IP', state: 'complete', note: 'EGRESS-PROOF green (Railway static outbound IPs; worker egresses from an allowlist-ready IP).' },
  { id: '4A', name: '4A — Audit fail-closed', state: 'pending', note: 'Implemented locally, in review; not yet enabled in live tier.' },
  { id: '4C', name: '4C — Queue no-silent-loss', state: 'pending', note: 'Committed; migrations not applied, sweeper not enabled.' },
  { id: 'A4', name: 'A4 — Mainnet credentials', state: 'pending', note: 'Per-bot key recipe prepared; no keys created.' },
  { id: 'A11', name: 'A11 — Authorized tiny-live run', state: 'pending', note: 'Not authorized.' },
]

export function GateProgress({ gates = DEFAULT_GATES }: { gates?: Gate[] }) {
  const complete = gates.filter((g) => g.state === 'complete').length
  const allComplete = complete === gates.length

  return (
    <section aria-label="gate-progress" className="card" data-testid="gate-progress">
      <h2>Production readiness gates</h2>
      <p className="hint" data-testid="gate-summary">
        {complete}/{gates.length} complete. Mainnet activation is <strong>locked</strong> until all gates pass —
        the platform runs testnet only. Real funds NO-GO.
      </p>
      <div className="gate-list">
        {gates.map((g) => (
          <div key={g.id} className="gate" data-testid={`gate-${g.id}`}>
            <span className={`badge ${g.state === 'complete' ? 'ok' : 'pending'}`}>
              {g.state === 'complete' ? 'PASS' : 'PENDING'}
            </span>
            <span className="gate-name">{g.name}</span>
            <span className="gate-note">{g.note}</span>
          </div>
        ))}
      </div>
      {!allComplete && (
        <p className="banner lock" data-testid="mainnet-locked" style={{ marginTop: 12 }}>
          Mainnet activation controls are disabled until the gates above are complete.
        </p>
      )}
    </section>
  )
}
