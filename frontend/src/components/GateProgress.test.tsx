import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { GateProgress, DEFAULT_GATES } from './GateProgress'

describe('GateProgress', () => {
  test('renders A1 as PASS and later gates as PENDING (default)', () => {
    render(<GateProgress />)
    expect(screen.getByTestId('gate-A1')).toHaveTextContent('PASS')
    expect(screen.getByTestId('gate-4A')).toHaveTextContent('PENDING')
    expect(screen.getByTestId('gate-A11')).toHaveTextContent('PENDING')
  })

  test('summary shows the complete count and the mainnet-locked banner while pending', () => {
    render(<GateProgress />)
    const complete = DEFAULT_GATES.filter((g) => g.state === 'complete').length
    expect(screen.getByTestId('gate-summary')).toHaveTextContent(`${complete}/${DEFAULT_GATES.length} complete`)
    expect(screen.getByTestId('mainnet-locked')).toBeInTheDocument()
  })

  test('no mainnet-locked banner once every gate is complete', () => {
    const all = DEFAULT_GATES.map((g) => ({ ...g, state: 'complete' as const }))
    render(<GateProgress gates={all} />)
    expect(screen.queryByTestId('mainnet-locked')).not.toBeInTheDocument()
  })

  test('is informational only — renders no interactive controls', () => {
    const { container } = render(<GateProgress />)
    expect(container.querySelectorAll('button, input, a[href]').length).toBe(0)
  })
})
