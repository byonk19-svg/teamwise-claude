# Phase 10 — Richer Exports Design Spec

**Date:** 2026-03-25
**Status:** Approved

---

## Overview

Phase 10 adds export capabilities to Teamwise: a printable PDF of the 6-week schedule grid (available to managers and therapists) and three CSV data exports for managers (coverage report, KPI summary, staff roster).

---

## Goals

- Managers can print a clean PDF of the full 6-week schedule block
- Therapists can also print the schedule
- Managers can download coverage, KPI, and staff roster data as CSV files
- No new npm dependencies
- Minimal new API surface — reuse existing queries and helper functions

---

## Out of Scope

- Excel (`.xlsx`) format
- Therapist-specific personal exports (e.g. "my shifts only" PDF)
- Scheduled or emailed exports
- Date-range selection for schedule PDF (always full 6-week block)

---

## Architecture

### 1. Schedule Grid PDF (Print CSS)

**Approach:** Browser print dialog with `@media print` stylesheet. Clicking "Print Schedule" calls `window.print()`. The OS print dialog allows saving as PDF.

**New files:**
- `app/(app)/schedule/print.css` — print-specific styles (new file)
- `app/(app)/schedule/layout.tsx` — new pass-through layout that exists solely to import `print.css`, scoping print styles to the schedule route only. Implementation: `export default function ScheduleLayout({ children }: { children: React.ReactNode }) { return <>{children}</> }`. Does not duplicate the `<Sidebar>` / `<TopBar>` shell — those come from the parent `app/(app)/layout.tsx`.
- `components/schedule/PrintButton.tsx` — small `'use client'` component wrapping `window.print()`

**Print CSS behavior:**
- Hides: sidebar, topbar, `BlockStatusActions`, `CellPanel` overlay, all action buttons
- Preserves: schedule grid, therapist names, day headers, cell state colors, lead badges
- Adds: block name + date range header at top of printed page
- Uses `@page { size: landscape; margin: 10mm; }` to maximize grid space
- Grid columns compress to fit — all 42 day columns across the page width

**Access:** Both managers and therapists see the Print Schedule button. No role gate needed since the schedule page already enforces role-based data access.

---

### 2. Coverage CSV Export

**Location:** `/coverage` page — "Export CSV" button in the page header (manager-only, page is already manager-gated)

**Server action:** `exportCoverageCSV(blockId: string)` in `app/actions/coverage.ts` (new file — create with `'use server'` at top)

**Auth/role guard:** Call `getServerUser()`, then query `public.users` for `role` and `department_id`. Return `{ error: 'Manager access required' }` if role is not `manager`. (Same pattern as `app/actions/staff.ts`.)

**Query:** Three queries combined:
1. `shift_planned_headcount` view filtered by `blockId` — planned headcount per date/shift
2. `shift_actual_headcount` view filtered by `blockId` — actual headcount per date/shift. Note: actual headcount only exists for blocks with `status = 'active'` or `'completed'`; rows for other block statuses will have no actuals.
3. `(supabase as any).from('coverage_thresholds')` filtered by the manager's `department_id` — returns one row per `shift_type` with `minimum_staff` (manual-access table, Phase 9)

**CSV columns:**
```
date, shift_type, planned_headcount, actual_headcount, threshold, status
```

Where `threshold` is `coverage_thresholds.minimum_staff` for the matching `shift_type`, and `status` is:
- `n/a` if `actual_headcount` is not available (block is not active/completed)
- `critical` if `actual_headcount < threshold`
- `warning` if `actual_headcount === threshold`
- `ok` if `actual_headcount > threshold`

**Return type:** `{ data: string } | { error: string }`

**Client component:** `ExportCoverageButton` — calls action, triggers download via `Blob` + `URL.createObjectURL`, shows toast on error

**Filename:** `coverage-<block-name>-<date>.csv`

---

### 3. KPI Summary CSV Export

**Location:** `/ops` page — "Export CSV" button in the page header (manager-only)

**Server action:** `exportKPICSV(filters: OpsFilterParams)` in `app/actions/ops.ts`

**Shared type:** Declare `OpsFilterParams` in a new file `lib/ops/types.ts`:
```typescript
export interface OpsFilterParams {
  shift?: string
  blockId?: string
  from?: string
  to?: string
}
```
Import this type in both `app/actions/ops.ts` and the ops page component.

**Data source:** Reuses `buildBlockHealthRows` from `lib/ops/block-health.ts` — no new Supabase queries. The function returns `BlockHealthRow[]` with camelCase fields; convert to snake_case CSV headers on output.

**CSV columns** (mapped from `BlockHealthRow` camelCase fields):
```
block_id, shift_type, start_date, end_date, status,
lead_gap_dates, pending_swaps, pending_change_requests,
pending_prn_interest, low_coverage_dates, risk_score
```

Note: no `block_name` column — `BlockHealthRow` only exposes `blockId`. Use `block_id` directly.

One row per block (scoped by the same filters already applied on the ops dashboard).

**Return type:** `{ data: string } | { error: string }`

**Client component:** `ExportKPIButton` — same Blob download pattern

**Filename:** `kpi-summary-<date>.csv`

---

### 4. Staff Roster CSV Export

**Location:** `/staff` page — "Export CSV" button in the page header (manager-only)

**Server action:** `exportStaffCSV()` added to `app/actions/staff.ts` alongside existing staff actions

**Query:** Queries `public.users` filtered by the authenticated manager's `department_id`

**CSV columns:**
```
full_name, email, role, employment_type, is_lead_qualified, is_active, created_at
```

**Return type:** `{ data: string } | { error: string }`

**Client component:** `ExportStaffButton` — same Blob download pattern

**Filename:** `staff-roster-<date>.csv`

---

## Shared Patterns

### CSV Download Helper
A small utility `lib/exports/download-csv.ts` exports `downloadCSV(filename: string, csvData: string)` — creates a `Blob`, calls `URL.createObjectURL`, clicks a hidden anchor, and revokes the URL. All three CSV export buttons use this helper.

### Error Handling
All CSV server actions return `{ data: string } | { error: string }`. Client components show a destructive toast on error using the existing toast pattern (same as swap/change-request flows).

### Role Guard
- Print Schedule: no additional guard (page-level auth already applies)
- All CSV exports: manager-only via existing `role` check on the server action (same pattern as `app/actions/staff.ts`)

---

## Components Summary

| Component | File | Type |
|-----------|------|------|
| `PrintButton` | `components/schedule/PrintButton.tsx` | Client |
| `ExportCoverageButton` | `components/coverage/ExportCoverageButton.tsx` | Client |
| `ExportKPIButton` | `components/ops/ExportKPIButton.tsx` | Client |
| `ExportStaffButton` | `components/staff/ExportStaffButton.tsx` | Client |

---

## Server Actions Summary

| Action | File | Notes |
|--------|------|-------|
| `exportCoverageCSV(blockId)` | `app/actions/coverage.ts` (new file) | Manager-only |
| `exportKPICSV(filters)` | `app/actions/ops.ts` | Manager-only; add to existing file |
| `exportStaffCSV()` | `app/actions/staff.ts` | Manager-only; add to existing file |

---

## Utility Files

| File | Purpose |
|------|---------|
| `app/(app)/schedule/print.css` | `@media print` styles for schedule grid (new) |
| `app/(app)/schedule/layout.tsx` | Pass-through layout to scope print CSS (new) |
| `lib/exports/download-csv.ts` | Shared Blob download helper (new) |
| `lib/ops/types.ts` | `OpsFilterParams` interface shared by ops page + export action (new) |

---

## Testing

**Unit tests (Vitest) — 4 new tests in `tests/unit/exports.test.ts`:**
1. `exportCoverageCSV` — assert CSV header row matches spec; row count matches mock data
2. `exportKPICSV` — assert CSV header row; filters applied correctly
3. `exportStaffCSV` — assert CSV header row; department filter applied
4. `downloadCSV` helper — assert Blob is created with correct MIME type. **Requires jsdom environment:** add `// @vitest-environment jsdom` at the top of `exports.test.ts`. Mock `URL.createObjectURL` and `URL.revokeObjectURL` via `vi.stubGlobal` before the test runs, as these are not available in the default Vitest node environment.

**E2E:** No new Playwright specs. Print and file download automation is unreliable without significant infrastructure overhead (out of scope for this phase).

**CLAUDE.md update:** After all tests pass, update the unit test count in CLAUDE.md from **114** to **118**.

---

## Migration

No database migrations required. All data is read from existing tables and views.

---

## Dependencies

No new npm packages.
