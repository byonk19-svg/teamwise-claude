// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCoverageCSV } from '@/lib/exports/build-coverage-csv'
import { buildKPICSV } from '@/lib/exports/build-kpi-csv'
import { buildStaffCSV } from '@/lib/exports/build-staff-csv'
import { downloadCSV } from '@/lib/exports/download-csv'

describe('buildCoverageCSV', () => {
  it('outputs correct header and one data row', () => {
    const rows = [
      { date: '2026-04-01', shift_type: 'day', planned_headcount: 4, actual_headcount: 3 },
    ]
    const csv = buildCoverageCSV(rows, 3)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('date,shift_type,planned_headcount,actual_headcount,threshold,status')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('ok')
  })
})

describe('buildKPICSV', () => {
  it('outputs correct header and one data row', () => {
    const rows = [
      {
        blockId: 'b1',
        shiftType: 'day',
        startDate: '2026-04-01',
        endDate: '2026-05-12',
        status: 'active',
        leadGapDates: 1,
        pendingSwaps: 0,
        pendingChangeRequests: 2,
        pendingPrnInterest: 0,
        lowCoverageDates: 1,
        riskScore: 4,
      },
    ]
    const csv = buildKPICSV(rows)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe(
      'block_id,shift_type,start_date,end_date,status,lead_gap_dates,pending_swaps,pending_change_requests,pending_prn_interest,low_coverage_dates,risk_score'
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('b1')
  })
})

describe('buildStaffCSV', () => {
  it('outputs correct header and filters to department data', () => {
    const users = [
      {
        full_name: 'Jane Smith',
        email: 'j@t.dev',
        role: 'therapist',
        employment_type: 'ft',
        is_lead_qualified: true,
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const csv = buildStaffCSV(users)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('full_name,email,role,employment_type,is_lead_qualified,is_active,created_at')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Jane Smith')
  })
})

describe('downloadCSV', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('creates a Blob with text/csv MIME type', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el)
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el)
    downloadCSV('test.csv', 'a,b\n1,2')
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv')
    appendSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
