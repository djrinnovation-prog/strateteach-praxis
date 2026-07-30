import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { TradingViewConnect, generateToken, TV_PAYLOAD_TEMPLATE } from './TradingViewConnect'

const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/

// jsdom in this setup doesn't expose Web Storage; install an in-memory mock so we can PROVE the
// component writes nothing to it (the safety invariant), and dump it to check the token never lands there.
function makeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size },
    dump: () => Array.from(m.entries()),
  }
}
let ls: ReturnType<typeof makeStorage>
let ss: ReturnType<typeof makeStorage>
beforeEach(() => {
  ls = makeStorage(); ss = makeStorage()
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('sessionStorage', ss)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('generateToken', () => {
  test('produces a URL-safe token matching the server TOKEN_RE', () => {
    for (let i = 0; i < 25; i++) expect(generateToken()).toMatch(TOKEN_RE)
  })
})

describe('TradingViewConnect (UI-3a)', () => {
  test('no token → Generate → reveal-once shows the token, URL, and template', async () => {
    const rotate = vi.fn().mockResolvedValue({ ok: true, new_fp: 'ab..cd' })
    render(<TradingViewConnect botId="bot-1" tokenSet={false} webhookBase="https://x.supabase.co" rotate={rotate} />)
    fireEvent.click(screen.getByTestId('tv-generate'))
    await waitFor(() => screen.getByTestId('tv-reveal'))
    expect(rotate).toHaveBeenCalledTimes(1)
    const passed = rotate.mock.calls[0][1] as string
    expect(passed).toMatch(TOKEN_RE)                                   // client-generated, valid shape
    expect(screen.getByTestId('tv-token-value').textContent).toBe(passed)          // shown once
    expect(screen.getByTestId('tv-webhook-url').textContent).toContain(`/functions/v1/webhook/bot-1/${passed}`)
    expect(screen.getByTestId('tv-template').textContent).toBe(TV_PAYLOAD_TEMPLATE)
  })

  test('token is NEVER written to localStorage / sessionStorage', async () => {
    const rotate = vi.fn().mockResolvedValue({ ok: true })
    render(<TradingViewConnect botId="bot-1" tokenSet={false} rotate={rotate} />)
    fireEvent.click(screen.getByTestId('tv-generate'))
    await waitFor(() => screen.getByTestId('tv-reveal'))
    const token = rotate.mock.calls[0][1] as string
    expect(ls.length).toBe(0)
    expect(ss.length).toBe(0)
    expect(JSON.stringify([...ls.dump(), ...ss.dump()])).not.toContain(token)
  })

  test('reveal-once: token is gone from the DOM after "I saved" + Done', async () => {
    const rotate = vi.fn().mockResolvedValue({ ok: true })
    render(<TradingViewConnect botId="bot-1" tokenSet={false} rotate={rotate} />)
    fireEvent.click(screen.getByTestId('tv-generate'))
    await waitFor(() => screen.getByTestId('tv-reveal'))
    const token = rotate.mock.calls[0][1] as string
    expect(screen.getByTestId('tv-done')).toBeDisabled()              // gated on "I saved"
    fireEvent.click(screen.getByTestId('tv-saved-check'))
    expect(screen.getByTestId('tv-done')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('tv-done'))
    expect(screen.queryByTestId('tv-reveal')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(token)             // token wiped from the DOM
  })

  test('rotating an existing token WARNS first (invalidates old alerts)', () => {
    render(<TradingViewConnect botId="bot-1" tokenSet={true} />)
    expect(screen.getByTestId('tv-generate')).toHaveTextContent(/Rotate/)
    fireEvent.click(screen.getByTestId('tv-generate'))
    expect(screen.getByTestId('tv-warn')).toHaveTextContent(/invalidates any existing TradingView alerts/i)
  })

  test('Send-test is disabled until a token is saved; then read-back shows queued', async () => {
    const rotate = vi.fn().mockResolvedValue({ ok: true })
    const sendTest = vi.fn().mockResolvedValue({ status: 'queued' })
    render(<TradingViewConnect botId="bot-1" tokenSet={false} rotate={rotate} sendTest={sendTest} />)
    expect(screen.getByTestId('tv-test')).toBeDisabled()             // not saved yet
    fireEvent.click(screen.getByTestId('tv-generate'))
    await waitFor(() => screen.getByTestId('tv-reveal'))
    fireEvent.click(screen.getByTestId('tv-saved-check'))
    fireEvent.click(screen.getByTestId('tv-done'))
    expect(screen.getByTestId('tv-test')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('tv-test'))
    await waitFor(() => screen.getByTestId('tv-test-result'))
    expect(screen.getByTestId('tv-test-status')).toHaveTextContent('queued')
    expect(sendTest).toHaveBeenCalledWith('bot-1')
  })

  test('the token is never passed to console.*', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const rotate = vi.fn().mockResolvedValue({ ok: true })
    render(<TradingViewConnect botId="bot-1" tokenSet={false} rotate={rotate} />)
    fireEvent.click(screen.getByTestId('tv-generate'))
    await waitFor(() => screen.getByTestId('tv-reveal'))
    const token = rotate.mock.calls[0][1] as string
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(token)
      s.mockRestore()
    }
  })

  test('rotate failure surfaces an error and does not reveal a token', async () => {
    const rotate = vi.fn().mockResolvedValue({ ok: false, error: 'denied' })
    render(<TradingViewConnect botId="bot-1" tokenSet={false} rotate={rotate} />)
    fireEvent.click(screen.getByTestId('tv-generate'))
    await waitFor(() => screen.getByTestId('tv-error'))
    expect(screen.queryByTestId('tv-reveal')).not.toBeInTheDocument()
  })
})
