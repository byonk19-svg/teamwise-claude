# Supabase migrations

Apply these **in numeric order** in the Supabase SQL Editor (or via `supabase db push` if you use the CLI against this folder).

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Core schema: users, departments, blocks, shifts, coverage_thresholds, swaps/PRN/coverage RLS, etc. |
| `002_phase2_rpcs.sql` | `copy_block`, `get_constraint_diff` |
| `003_phase4_swaps.sql` | `swap_requests`, `assign_lead`, planned headcount view, swap expiry job |
| `004_phase5_operational.sql` | `operational_entries`, actuals view, operational RPCs, auto-activate job |
| `005_phase5_rls_hardening.sql` | Department-scoped RLS for swaps + operational entries |
| `006_phase8_notifications.sql` | `notifications`, `push_subscriptions` + RLS |
| `007_phase9_swap_cancelled.sql` | Allow `swap_requests.status = 'cancelled'` (staff deactivation) |

After applying, confirm tables and policies in the Supabase dashboard.

## TypeScript types

This repo keeps **`lib/types/database.types.ts`** as a **manual stub** aligned with the app (plus documented manual tables). Regenerating from Supabase is optional; if you do, merge carefully with existing stubs and casts documented in **CLAUDE.md** (`(supabase as any)` for manually typed tables).
