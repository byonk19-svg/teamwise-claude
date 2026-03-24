import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CoverageHeatmap } from '@/components/coverage/CoverageHeatmap'
import type { Database } from '@/lib/types/database.types'

type HeadcountRow = Database['public']['Views']['shift_planned_headcount']['Row']
type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']

describe('CoverageHeatmap', () => {
  const headcount: HeadcountRow[] = [
    {
      schedule_block_id: 'b1',
      shift_date: '2026-03-01',
      ft_count: 3,
      prn_count: 1,
      total_count: 4,
    },
  ]

  const actualHeadcount: ActualHeadcountRow[] = [
    {
      schedule_block_id: 'b1',
      shift_date: '2026-03-01',
      ft_planned: 3,
      prn_planned: 1,
      total_planned: 4,
      ft_actual: 2,
      prn_actual: 1,
      total_actual: 3,
    },
  ]

  it('always renders the Actual header column', () => {
    render(
      <CoverageHeatmap
        headcount={headcount}
        leadGapDates={new Set<string>()}
        blockStartDate="2026-03-01"
        actualHeadcount={[]}
        blockStatus="final"
      />
    )

    expect(screen.getByText('Actual')).toBeInTheDocument()
  })

  it('renders actual totals for active/completed blocks', () => {
    render(
      <CoverageHeatmap
        headcount={headcount}
        leadGapDates={new Set<string>()}
        blockStartDate="2026-03-01"
        actualHeadcount={actualHeadcount}
        blockStatus="active"
      />
    )

    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
  })

  it('renders dash placeholders for pre-active statuses', () => {
    render(
      <CoverageHeatmap
        headcount={headcount}
        leadGapDates={new Set<string>()}
        blockStartDate="2026-03-01"
        actualHeadcount={actualHeadcount}
        blockStatus="final"
      />
    )

    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
  })
})
