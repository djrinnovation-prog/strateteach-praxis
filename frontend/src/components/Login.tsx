// Login.tsx — minimal internal-operator login (S5 Slice 1c). Email magic-link via Supabase Auth with
// shouldCreateUser=false → NO public signup; operators are pre-provisioned. No password UI, no settings,
// no role management. No secrets handled here.
import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LoginProps {
  client: Pick<SupabaseClient, 'auth'>
}

export function Login({ client }: LoginProps) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('sending')
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }, // internal only — never create accounts from the login form
    })
    setState(error ? 'error' : 'sent')
  }

  return (
    <main aria-label="operator-login">
      <h1>Praxis — Operator Console</h1>
      <form onSubmit={submit}>
        <label htmlFor="op-email">Operator email</label>
        <input
          id="op-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <button type="submit" disabled={state === 'sending'}>Send magic link</button>
      </form>
      {state === 'sent' && <p role="status">If this email is a registered operator, a sign-in link has been sent.</p>}
      {state === 'error' && <p role="alert">Could not send the link. Try again.</p>}
    </main>
  )
}
