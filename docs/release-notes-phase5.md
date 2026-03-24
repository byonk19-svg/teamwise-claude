# Teamwise Phase 5 Release Notes

Date: 2026-03-24

## Highlights

- Added operational layer workflow for in-shift staffing events (`OC`, `CI`, `CX`, `LE`).
- Added mobile-first WeekView flow with bottom-sheet operational code entry.
- Added planned vs actual coverage visibility and realtime alerting hooks.
- Added manager audit log page with CSV export for completed blocks.
- Hardened mutation safety checks and tightened department-scoped RLS policies.

## Major Features Delivered

- `operational_entries` support with soft-delete semantics.
- `shift_actual_headcount` view for DB-computed planned/actual counts.
- New server actions:
  - `enterCode`
  - `removeCode`
  - `revertToFinal`
- Schedule UI:
  - `OperationalCodeEntry` in cell detail flow
  - mobile `WeekView` for operational usage
- Coverage UI:
  - `Actual` column support
  - `AlertBanner` realtime alert entry point
- Audit UI:
  - `/audit/[blockId]` manager view
  - CSV export via `AuditLog`

## Hardening and Safety

- Added block-status re-verification before shift mutations in:
  - `resolveChangeRequest`
  - `resolvePrnInterest`
  - `resolveSwap`
- Added backward-compatible Phase 5 RLS migration for legacy schema variants.
- Replaced broad authenticated RLS with department-scoped policies for:
  - `swap_requests`
  - `operational_entries`

## Migrations

Run in order:

1. `003_phase4_swaps.sql` (cron block may require enabling `pg_cron`)
2. `004_phase5_operational.sql`
3. `005_phase5_rls_hardening.sql` (backward-compatible version in repo)

## Verification Summary

- Typecheck: pass (`npx tsc --noEmit`)
- Unit tests: pass (`86/86`)
- Production build: pass (`npm run build`)
- Added guarded Playwright Phase 5 spec:
  - `tests/e2e/phase5-operational.spec.ts`
  - runs when `E2E_AUTH=true`

## Commits Included

- `dccaab4` feat: implement phase 5 operational layer workflows
- `57cfd5d` fix: harden phase 5 mutation guards and RLS policies
- `0c2cccb` fix: make phase 5 RLS migration backward compatible
- `d0b3b9f` test: add phase 5 operational Playwright coverage

## Operational Notes

- If local UI appears unresponsive after changes, clear `.next`, restart dev server, and hard refresh browser.
- `no_delete_op_entries` policy is intentionally retained to preserve soft-delete behavior.
