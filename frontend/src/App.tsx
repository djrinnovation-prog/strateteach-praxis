// App.tsx — Operator Console root (S5 Slice 1c). Auth gate: unauthenticated → Login; authenticated →
// StatusPanel. Takes the Supabase client as a prop so tests inject a mock (no env read).
//
// A8-H2 KILL CONTROL — FEATURE-GATED, DEFAULT OFF. The guarded one-click kill renders ONLY when
// `killEnabled` is true (defaults to the VITE_OPERATOR_KILL_ENABLED env flag === 'true'). While OFF the
// console is READ-ONLY with NO mutation control. This keeps the kill button INERT until the full deploy
// sequence is satisfied:
//   1) linked migration 019 (operator_kill_all) is applied,
//   2) an operator explicitly sets VITE_OPERATOR_KILL_ENABLED=true,
//   3) the deploy is approved.
// So an accidental/stale deploy before 019 cannot expose a kill control that calls a missing RPC.
// When ON, the only trading mutation is the audited kill (operator_kill_all); there is NO enable/arm/fire,
// and the kill never re-arms.
import { useCallback, useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { Login } from './components/Login'
import { StatusPanel } from './components/StatusPanel'
import { HarnessPanel } from './components/HarnessPanel'
import { GateProgress } from './components/GateProgress'
import { BotSetupWizard } from './components/BotSetupWizard'
import { PilotCockpit } from './components/PilotCockpit'
import { UserDashboard } from './components/UserDashboard'
import { loadOperatorStatus } from './lib/status'
import { loadPilotFleet } from './lib/pilot'
import { loadUserDashboard, pauseOwnBot } from './lib/userDashboard'
import { operatorKillAll } from './lib/actions'
import { rotateWebhookToken, loadUserBots, type UserBot } from './lib/tradingview'

type ConsoleView = 'operator' | 'setup' | 'pilot'
/** Pilot routing role. Only meaningful when pilotEnabled; otherwise everyone gets the operator shell. */
type Role = 'unknown' | 'operator' | 'user'

export interface AppProps {
  client: SupabaseClient
  /** A8-H2 kill gate. Defaults to the VITE_OPERATOR_KILL_ENABLED env flag (default OFF). Tests inject it. */
  killEnabled?: boolean
  /** Ops Harness read-only panel gate. Defaults to VITE_OPERATOR_HARNESS_ENABLED (default OFF). Tests inject it. */
  harnessEnabled?: boolean
  /** UI-3a TradingView token flow gate. Defaults to VITE_TV_CONNECT_ENABLED (default OFF). Tests inject it.
   *  While OFF, Step 4 of the setup wizard stays the locked preview and NO rotation can be triggered. */
  tvConnectEnabled?: boolean
  /** StrateTeach ST-1 pilot cockpit gate. Defaults to VITE_STRATETEACH_PILOT (default OFF). Tests inject it.
   *  While OFF, the Pilot cockpit tab is not shown and cannot be reached. Read-only either way. */
  pilotEnabled?: boolean
}

export function App({
  client,
  killEnabled = import.meta.env.VITE_OPERATOR_KILL_ENABLED === 'true',
  harnessEnabled = import.meta.env.VITE_OPERATOR_HARNESS_ENABLED === 'true',
  tvConnectEnabled = import.meta.env.VITE_TV_CONNECT_ENABLED === 'true',
  pilotEnabled = import.meta.env.VITE_STRATETEACH_PILOT === 'true',
}: AppProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [consoleView, setConsoleView] = useState<ConsoleView>('operator')
  const [userBots, setUserBots] = useState<UserBot[]>([])
  // Pilot routing: probe operator-ness so a NON-operator sees ONLY their own dashboard. When the pilot flag
  // is OFF, everyone keeps the legacy operator shell (role forced 'operator', no extra probe).
  const [role, setRole] = useState<Role>(pilotEnabled ? 'unknown' : 'operator')
  const webhookBase = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''

  useEffect(() => {
    let alive = true
    void client.auth.getSession().then(({ data }) => {
      if (alive) {
        setSession(data.session)
        setReady(true)
      }
    })
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      if (alive) setSession(s)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [client])

  // Load the user's own bots for the setup selector — ONLY when the TV flow is enabled and the user is
  // on the setup tab. RLS scopes the read to the caller's bots. A failure leaves the list empty (Step 4
  // stays locked) — never throws into the render.
  useEffect(() => {
    if (!session || !tvConnectEnabled || consoleView !== 'setup') return
    let alive = true
    void loadUserBots(client).then(
      (b) => { if (alive) setUserBots(b) },
      () => { if (alive) setUserBots([]) },
    )
    return () => { alive = false }
  }, [client, session, tvConnectEnabled, consoleView])

  // Pilot routing probe: only when the flag is on. operator_status() succeeds for operators; it RAISEs 42501
  // for non-operators → route them to the user dashboard. Any error resolves to 'user' (least privilege).
  useEffect(() => {
    if (!session) return
    if (!pilotEnabled) { setRole('operator'); return }
    let alive = true
    setRole('unknown')
    loadOperatorStatus(client).then(
      () => { if (alive) setRole('operator') },
      () => { if (alive) setRole('user') },
    )
    return () => { alive = false }
  }, [client, session, pilotEnabled])

  // Stable across re-renders so StatusPanel's effect does not refetch on every render.
  const loadStatus = useCallback(() => loadOperatorStatus(client), [client])
  const loadFleet = useCallback(() => loadPilotFleet(client), [client])
  const loadUserDash = useCallback(() => loadUserDashboard(client), [client])
  const pauseBot = useCallback((botId: string) => pauseOwnBot(client, botId), [client])
  const killAll = useCallback((reason: string) => operatorKillAll(client, { reason }), [client])
  const rotateToken = useCallback(
    (botId: string, token: string) => rotateWebhookToken(client, botId, token),
    [client],
  )

  if (!ready) return <p role="status">Loading…</p>
  if (!session) return <Login client={client} />
  if (pilotEnabled && role === 'unknown') return <p role="status">Loading…</p>

  // Pilot routing: a NON-operator user sees ONLY their own dashboard — never the operator console/cockpit.
  if (pilotEnabled && role === 'user') {
    return (
      <div className="app-shell">
        <header className="app-header">
          <span className="brand">StrateTeach — My bots</span>
          <button type="button" className="btn secondary" onClick={() => { void client.auth.signOut() }}>Sign out</button>
        </header>
        <UserDashboard loadBots={loadUserDash} pause={pauseBot} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">Praxis — Operator Console{killEnabled ? '' : ' (read-only)'}</span>
        <button type="button" className="btn secondary" onClick={() => { void client.auth.signOut() }}>Sign out</button>
      </header>

      {/* Two products, one shell: the operator fleet console and the user bot-setup preview. */}
      <nav className="app-nav" aria-label="console-view">
        <button type="button" aria-current={consoleView === 'operator'} onClick={() => setConsoleView('operator')}>
          Operator console
        </button>
        <button type="button" aria-current={consoleView === 'setup'} onClick={() => setConsoleView('setup')}>
          Bot setup
        </button>
        {/* StrateTeach pilot cockpit tab — rendered ONLY when its default-OFF flag is on. */}
        {pilotEnabled && (
          <button type="button" aria-current={consoleView === 'pilot'} onClick={() => setConsoleView('pilot')}>
            Pilot cockpit
          </button>
        )}
      </nav>

      <GateProgress />

      {consoleView === 'operator' && (
        <>
          {/* Kill control passed ONLY when the flag is ON — otherwise the panel is read-only. */}
          <StatusPanel loadStatus={loadStatus} killAll={killEnabled ? killAll : undefined} />
          {/* Ops Harness (read-only) rendered ONLY when its own default-OFF flag is on. */}
          {harnessEnabled && <HarnessPanel loadStatus={loadStatus} />}
        </>
      )}

      {consoleView === 'setup' && (
        <BotSetupWizard
          tv={{ enabled: tvConnectEnabled, webhookBase, bots: userBots, rotate: rotateToken }}
        />
      )}

      {/* Read-only pilot cockpit — reachable only while the flag is on (belt-and-suspenders re-check). */}
      {consoleView === 'pilot' && pilotEnabled && (
        <PilotCockpit loadStatus={loadStatus} loadFleet={loadFleet} />
      )}
    </div>
  )
}
