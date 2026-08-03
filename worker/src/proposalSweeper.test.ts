/**
 * proposalSweeper.test.ts — 045: expire stale pending proposals. Default-OFF no-op; enabled marks
 * 'pending' past expires_at as 'expired'; never throws.
 */
import { startProposalSweeper } from './proposalSweeper'

function makeSb(updateResult: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {}
  chain.from = jest.fn(() => chain)
  chain.update = jest.fn(() => chain)
  chain.eq = jest.fn(() => chain)
  chain.lt = jest.fn(() => chain)
  chain.select = jest.fn(() => Promise.resolve(updateResult) as unknown as ReturnType<jest.Mock>)
  return chain
}
const noTimer = { setIntervalImpl: () => ({}), clearIntervalImpl: () => {} }

describe('proposalSweeper', () => {
  afterEach(() => jest.restoreAllMocks())

  test('disabled → sweepOnce is a no-op (no update issued)', async () => {
    const sb = makeSb({ data: [], error: null })
    await startProposalSweeper({ supabase: sb as never, enabled: false }).sweepOnce()
    expect(sb.update).not.toHaveBeenCalled()
  })

  test('enabled → marks stale pending proposals expired', async () => {
    const sb = makeSb({ data: [{ id: 'p1' }, { id: 'p2' }], error: null })
    await startProposalSweeper({ supabase: sb as never, enabled: true, ...noTimer }).sweepOnce()
    expect(sb.from).toHaveBeenCalledWith('proposed_trades')
    expect(sb.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }))
    expect(sb.eq).toHaveBeenCalledWith('status', 'pending')
  })

  test('never throws on a DB error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const sb = makeSb({ data: null, error: { code: 'X' } })
    await expect(startProposalSweeper({ supabase: sb as never, enabled: true, ...noTimer }).sweepOnce()).resolves.toBeUndefined()
  })
})
