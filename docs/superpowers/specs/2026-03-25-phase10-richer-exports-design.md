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
- `app/(app)/schedule/print.css` — print-specific styles (imported in schedule layout)
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

**Server action:** `exportCoverageCSV(blockId: string)` in `app/actions/coverage.ts`

**Query:** Joins `shift_planned_headcount` and `shift_actual_headcount` views, filtered by `blockId`

**CSV columns:**
```
date, shift_type, planned_headcount, actual_headcount, threshold, status
```

Where `status` is `ok | warning | critical` derived by comparing `actual_headcount` against `threshold` (same logic as `CoverageHeatmap`).

**Return type:** `{ data: string } | { error: string }`

**Client component:** `ExportCoverageButton` — calls action, triggers download via `Blob` + `URL.createObjectURL`, shows toast on error

**Filename:** `coverage-<block-name>-<date>.csv`

---

### 3. KPI Summary CSV Export

**Location:** `/ops` page — "Export CSV" button in the page header (manager-only)

**Server action:** `exportKPICSV(filters: OpsFilters)` in `app/actions/ops.ts`

**Data source:** Reuses existing KPI helper functions in `lib/ops/` — no new Supabase queries

**CSV columns:**
```
block_name, shift_type, date_range_start, date_range_end, avg_coverage_pct,
total_swaps, resolved_swaps, pending_swaps,
total_change_requests, resolved_change_requests
```

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

| Action | File | Role |
|--------|------|------|
| `exportCoverageCSV(blockId)` | `app/actions/coverage.ts` | Manager |
| `exportKPICSV(filters)` | `app/actions/ops.ts` | Manager |
| `exportStaffCSV()` | `app/actions/staff.ts` | Manager |

---

## Utility Files

| File | Purpose |
|------|---------|
| `app/(app)/schedule/print.css` | `@media print` styles for schedule grid |
| `lib/exports/download-csv.ts` | Shared Blob download helper |

---

## Testing

**Unit tests (Vitest) — 4 new tests in `tests/unit/exports.test.ts`:**
1. `exportCoverageCSV` — assert CSV header row matches spec; row count matches mock data
2. `exportKPICSV` — assert CSV header row; filters applied correctly
3. `exportStaffCSV` — assert CSV header row; department filter applied
4. `downloadCSV` helper — assert Blob is created with correct MIME type

**E2E:** No new Playwright specs. Print and file download automation is unreliable without significant infrastructure overhead (out of scope for this phase).

---

## Migration

No database migrations required. All data is read from existing tables and views.

---

## Dependencies

No new npm packages.
