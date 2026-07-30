import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Login } from './Login'

function authClient() {
  const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
  return { client: { auth: { signInWithOtp } } as unknown as Pick<SupabaseClient, 'auth'>, signInWithOtp }
}

describe('Login', () => {
  test('renders the operator email form (no signup/settings/role controls)', () => {
    const { client } = authClient()
    render(<Login client={client} />)
    expect(screen.getByLabelText('Operator email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument()
    // no signup / role-management affordances
    expect(document.body.textContent ?? '').not.toMatch(/\b(sign ?up|create account|role|operator access toggle)\b/i)
  })
})
