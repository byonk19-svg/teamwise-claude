# Phase 1: Foundation — Teamwise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Teamwise Next.js app with Supabase schema, provider-abstracted auth, role-aware shell, and a working Day/Night calendar grid rendering seeded data — nothing interactive yet except the cell slide-out panel.

**Architecture:** Next.js 14 App Router with server components for all data fetching, client components only where interactivity is required (CellPanel, ShiftToggle, TopBar notification dot). Auth is wrapped behind `lib/auth.ts` — no other file calls Supabase Auth APIs directly. **Exception:** `middleware.ts` must call Supabase directly because Next.js middleware runs before `next/headers` cookies are available — this is a deliberate, documented exception to the abstraction rule. The calendar grid uses a shared `.grid-row` CSS class with `display: grid; grid-template-columns: 160px repeat(42, ...)` applied to every row, so all 43 columns align perfectly across FT, PRN, and count rows without a shared parent. Day/Night color is a CSS custom property (`--shift-color`) set at the grid root via a `data-shift` attribute — toggling shifts is a data attribute swap, not a component re-render.

**Tech Stack:** Next.js 14, TypeScript, Supabase (Auth + Postgres + @supabase/ssr), Tailwind CSS, shadcn/ui, @ducanh2912/next-pwa, Vitest, Playwright

**Spec references:**
- PRD v5.2: `C:\Users\byonk\Downloads\teamwise-prd-v5.2-COMPLETE.docx` (sections 2, 6, 7.1, 11)
- Roadmap v1.0: `C:\Users\byonk\Downloads\teamwise-roadmap-v1.md` (Phase 1)

---

## File Map

```
teamwise-claude/
├── app/
│   ├── layout.tsx                        # Root layout: fonts, global CSS, providers
│   ├── page.tsx                          # Root redirect → /schedule
│   ├── (auth)/
│   │   ├── layout.tsx                    # Auth layout: no sidebar, centered card
│   │   └── login/
│   │       └── page.tsx                  # Login form (email + password)
│   └── (app)/
│       ├── layout.tsx                    # App shell: sidebar + topbar + outlet
│       └── schedule/
│           └── page.tsx                  # Schedule page: fetches block + shifts, renders grid
├── components/
│   ├── shell/
│   │   ├── Sidebar.tsx                   # Role-aware nav; collapses to icons <1280px
│   │   └── TopBar.tsx                    # User name, role badge, notification dot
│   └── schedule/
│       ├── ScheduleGrid.tsx              # CSS grid container; renders all rows
│       ├── GridCell.tsx                  # Single cell: state → visual (working/*/off/fmla)
│       ├── ShiftToggle.tsx               # Day/Night toggle (client); sets CSS custom property
│       └── CellPanel.tsx                 # Slide-out panel (client); shows name/date/state
├── lib/
│   ├── auth.ts                           # ONLY file that calls Supabase Auth APIs
│   ├── supabase/
│   │   ├── client.ts                     # createBrowserClient (client components)
│   │   └── server.ts                     # createServerClient (server components/actions)
│   └── types/
│       └── database.types.ts             # Supabase generated types (manual for now)
├── middleware.ts                         # Route guard: redirect unauthenticated → /login
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql        # All tables, enums, RLS, triggers, views
│   └── seed.ts                           # TypeScript seed script (service role key)
├── tests/
│   ├── setup.ts                          # Vitest global setup (jest-dom import)
│   ├── unit/
│   │   ├── auth.test.ts                  # Auth abstraction exports correct shape
│   │   └── cell-state.test.ts            # Cell state → class name logic
│   └── e2e/
│       ├── login.spec.ts                 # Login flow, redirect, logout
│       ├── grid.spec.ts                  # Grid renders, FT/PRN sections, count rows
│       └── cell-panel.spec.ts            # Cell click opens panel, panel closes
├── public/
│   └── manifest.json                     # PWA manifest (name, icons, theme color)
├── next.config.js                        # next-pwa config (@ducanh2912/next-pwa)
├── vitest.config.ts                      # Vitest config
├── playwright.config.ts                  # Playwright config
└── .env.local                            # NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY
```

---

## Task 1: Project Scaffold

**Files:**
- Create: all root config files
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `next.config.js`

- [ ] **Step 1.1: Scaffold Next.js 14 app**

```bash
cd /c/Users/byonk/teamwise-claude
npx create-next-app@14 . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --no-git
```

When prompted:
- Use App Router: Yes (already set by flag)
- This scaffolds into the current directory (`.`)

- [ ] **Step 1.2: Install core dependencies**

```bash
npm install @supabase/ssr @supabase/supabase-js
npm install @ducanh2912/next-pwa
npm install date-fns
```

- [ ] **Step 1.3: Install shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted: select Default style, Slate base color, CSS variables yes.

Then add the components we need for Phase 1:

```bash
npx shadcn@latest add button sheet badge separator
```

- [ ] **Step 1.4: Install dev/test dependencies**

```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
npm install -D @playwright/test
```

- [ ] **Step 1.5: Write `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 1.6: Write `tests/setup.ts`**

```typescript
// tests/setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 1.7: Write `playwright.config.ts`**

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

- [ ] **Step 1.8: Add test scripts to `package.json`**

Add to the `scripts` block:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"seed": "npx ts-node --project tsconfig.json supabase/seed.ts"
```

- [ ] **Step 1.9: Init git and make first commit**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js 14 app with Supabase, shadcn/ui, Vitest, Playwright"
```

---

## Task 2: Supabase Client Configuration

**Files:**
- Create: `.env.local`
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/types/database.types.ts`

- [ ] **Step 2.1: Create Supabase project**

Go to supabase.com → New project. Note the Project URL and anon key from Settings → API.

- [ ] **Step 2.2: Create `.env.local`**

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Add `.env.local` to `.gitignore` (create-next-app does this automatically — verify it's there).

- [ ] **Step 2.3: Write `lib/supabase/client.ts`**

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database.types'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2.4: Write `lib/supabase/server.ts`**

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types/database.types'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component — cookies are read-only. OK.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 2.5: Write `lib/types/database.types.ts`** (manual stub — run `supabase gen types` after schema is applied)

```typescript
// lib/types/database.types.ts
// Stub: replace with `npx supabase gen types typescript --project-id YOUR_ID` after Task 3

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'manager' | 'therapist'
          employment_type: 'full_time' | 'prn'
          is_lead_qualified: boolean
          default_shift_type: 'day' | 'night' | null
          department_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      schedule_blocks: {
        Row: {
          id: string
          department_id: string
          shift_type: 'day' | 'night'
          start_date: string
          end_date: string
          status: 'preliminary_draft' | 'preliminary' | 'final' | 'active' | 'completed'
          copied_from_block_id: string | null
          availability_window_open: string | null
          availability_window_close: string | null
          published_by: string | null
          published_at: string | null
          created_by: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['schedule_blocks']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['schedule_blocks']['Insert']>
      }
      shifts: {
        Row: {
          id: string
          schedule_block_id: string
          user_id: string
          shift_date: string
          cell_state: 'working' | 'cannot_work' | 'off' | 'fmla'
          lead_user_id: string | null
          is_cross_shift: boolean
          modified_after_publish: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['shifts']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['shifts']['Insert']>
      }
      departments: {
        Row: { id: string; name: string; created_at: string }
        Insert: Omit<Database['public']['Tables']['departments']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['departments']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
```

- [ ] **Step 2.6: Commit**

```bash
git add lib/ .env.local
git commit -m "feat: add Supabase client config and type stubs"
```

---

## Task 3: Database Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 3.1: Write `supabase/migrations/001_initial_schema.sql`**

```sql
-- supabase/migrations/001_initial_schema.sql
-- Teamwise complete schema — all phases defined here so Phase 1 decisions are never revisited

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role          AS ENUM ('manager', 'therapist');
CREATE TYPE employment_type    AS ENUM ('full_time', 'prn');
CREATE TYPE shift_type         AS ENUM ('day', 'night');
CREATE TYPE block_status       AS ENUM ('preliminary_draft', 'preliminary', 'final', 'active', 'completed');
CREATE TYPE cell_state         AS ENUM ('working', 'cannot_work', 'off', 'fmla');
CREATE TYPE operational_code   AS ENUM ('on_call', 'call_in', 'cancelled', 'left_early');
CREATE TYPE avail_entry_type   AS ENUM ('cannot_work', 'requesting_to_work', 'available_day', 'available_night', 'available_either');
CREATE TYPE change_req_type    AS ENUM ('move_shift', 'mark_off', 'other');
CREATE TYPE change_req_status  AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE swap_status        AS ENUM ('pending', 'approved', 'denied', 'expired', 'cancelled');
CREATE TYPE prn_interest_status AS ENUM ('pending', 'confirmed', 'declined');

-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE departments (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- USERS (mirrors auth.users via id FK)
-- ============================================================
CREATE TABLE users (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text UNIQUE NOT NULL,
  full_name         text NOT NULL,
  role              user_role NOT NULL DEFAULT 'therapist',
  employment_type   employment_type NOT NULL DEFAULT 'full_time',
  is_lead_qualified boolean NOT NULL DEFAULT false,
  default_shift_type shift_type,           -- NULL = PRN / flexible
  department_id     uuid REFERENCES departments(id),
  created_at        timestamptz DEFAULT now()
);

-- ============================================================
-- SCHEDULE_BLOCKS
-- ============================================================
CREATE TABLE schedule_blocks (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id            uuid NOT NULL REFERENCES departments(id),
  shift_type               shift_type NOT NULL,
  start_date               date NOT NULL,
  end_date                 date NOT NULL,
  status                   block_status NOT NULL DEFAULT 'preliminary_draft',
  copied_from_block_id     uuid REFERENCES schedule_blocks(id),
  availability_window_open  timestamptz,
  availability_window_close timestamptz,
  published_by             uuid REFERENCES users(id),
  published_at             timestamptz,
  created_by               uuid NOT NULL REFERENCES users(id),
  created_at               timestamptz DEFAULT now(),
  CONSTRAINT date_range_valid CHECK (end_date > start_date),
  CONSTRAINT block_is_42_days CHECK (end_date = start_date + INTERVAL '41 days')
);

-- ============================================================
-- SHIFTS — planning layer only; never mutated by op codes
-- One row per therapist per date per block.
-- ============================================================
CREATE TABLE shifts (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_block_id     uuid NOT NULL REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users(id),
  shift_date            date NOT NULL,
  cell_state            cell_state NOT NULL DEFAULT 'off',
  lead_user_id          uuid REFERENCES users(id),   -- lead/charge for this date
  is_cross_shift        boolean NOT NULL DEFAULT false,
  modified_after_publish boolean NOT NULL DEFAULT false,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE (schedule_block_id, user_id, shift_date)   -- one shift per user per date per block
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shifts_updated_at
  BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- OPERATIONAL_ENTRIES — append-only audit log
-- Overlaid on shifts; never modifies shifts table.
-- ============================================================
CREATE TABLE operational_entries (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id    uuid NOT NULL REFERENCES shifts(id),
  code        operational_code NOT NULL,
  note        text,
  entry_date  date NOT NULL,
  is_backfill boolean NOT NULL DEFAULT false,
  entered_by  uuid NOT NULL REFERENCES users(id),
  entered_at  timestamptz NOT NULL DEFAULT now(),
  removed_by  uuid REFERENCES users(id),
  removed_at  timestamptz,
  is_active   boolean NOT NULL DEFAULT true
);

-- Trigger: new active entry → deactivate all prior active entries for same shift
CREATE OR REPLACE FUNCTION deactivate_prior_op_entries()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE operational_entries
    SET    is_active = false
    WHERE  shift_id = NEW.shift_id
      AND  id != NEW.id
      AND  is_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deactivate_prior_op_entries
  AFTER INSERT ON operational_entries
  FOR EACH ROW EXECUTE FUNCTION deactivate_prior_op_entries();

-- ============================================================
-- AVAILABILITY_SUBMISSIONS + AVAILABILITY_ENTRIES
-- ============================================================
CREATE TABLE availability_submissions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_block_id uuid NOT NULL REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id),
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_block_id, user_id)
);

CREATE TABLE availability_entries (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES availability_submissions(id) ON DELETE CASCADE,
  entry_date    date NOT NULL,
  entry_type    avail_entry_type NOT NULL,
  note          text,
  UNIQUE (submission_id, entry_date)
);

-- ============================================================
-- PRELIMINARY_CHANGE_REQUESTS
-- ============================================================
CREATE TABLE preliminary_change_requests (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_block_id uuid NOT NULL REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  requester_id      uuid NOT NULL REFERENCES users(id),
  shift_id          uuid NOT NULL REFERENCES shifts(id),
  request_type      change_req_type NOT NULL,
  note              text,
  status            change_req_status NOT NULL DEFAULT 'pending',
  response_note     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  actioned_at       timestamptz,
  actioned_by       uuid REFERENCES users(id)
);

-- ============================================================
-- POST_PUBLISH_EDITS — logs manager edits to active blocks
-- ============================================================
CREATE TABLE post_publish_edits (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id      uuid NOT NULL REFERENCES shifts(id),
  edited_by     uuid NOT NULL REFERENCES users(id),
  edited_at     timestamptz NOT NULL DEFAULT now(),
  action_type   text NOT NULL DEFAULT 'post_publish_edit',
  field_changed text NOT NULL,
  old_value     text,
  new_value     text
);

-- ============================================================
-- SWAP_REQUESTS
-- ============================================================
CREATE TABLE swap_requests (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id             uuid NOT NULL REFERENCES users(id),
  target_id                uuid NOT NULL REFERENCES users(id),
  requester_shift_id       uuid NOT NULL REFERENCES shifts(id),
  target_shift_id          uuid NOT NULL REFERENCES shifts(id),
  status                   swap_status NOT NULL DEFAULT 'pending',
  is_cross_shift           boolean NOT NULL DEFAULT false,
  cross_shift_acknowledged boolean NOT NULL DEFAULT false,
  lead_impact_warning      boolean NOT NULL DEFAULT false,
  requester_note           text,
  denial_reason            text,
  expires_at               timestamptz NOT NULL,
  submitted_at             timestamptz NOT NULL DEFAULT now(),
  actioned_at              timestamptz,
  actioned_by              uuid REFERENCES users(id)
);

-- Trigger: new op entry on a shift → cancel any pending swaps for that shift
CREATE OR REPLACE FUNCTION cancel_pending_swaps_on_op_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE swap_requests
    SET    status = 'cancelled'
    WHERE  status = 'pending'
      AND  (requester_shift_id = NEW.shift_id OR target_shift_id = NEW.shift_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cancel_pending_swaps_on_op_entry
  AFTER INSERT ON operational_entries
  FOR EACH ROW EXECUTE FUNCTION cancel_pending_swaps_on_op_entry();

-- ============================================================
-- PRN_SHIFT_INTEREST
-- ============================================================
CREATE TABLE prn_shift_interest (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id),
  shift_id            uuid NOT NULL REFERENCES shifts(id),
  status              prn_interest_status NOT NULL DEFAULT 'pending',
  outside_availability boolean NOT NULL DEFAULT false,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  actioned_at         timestamptz,
  actioned_by         uuid REFERENCES users(id),
  UNIQUE (user_id, shift_id)
);

-- ============================================================
-- COVERAGE_THRESHOLDS
-- ============================================================
CREATE TABLE coverage_thresholds (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES departments(id),
  shift_type    shift_type NOT NULL,
  minimum_staff integer NOT NULL DEFAULT 3,
  ideal_staff   integer NOT NULL DEFAULT 4,
  maximum_staff integer NOT NULL DEFAULT 5,
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, shift_type)
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Planned headcount per date per block (used by grid count rows)
CREATE VIEW shift_planned_headcount AS
SELECT
  s.schedule_block_id,
  s.shift_date,
  COUNT(*) FILTER (
    WHERE s.cell_state = 'working'
    AND   (SELECT u.employment_type FROM users u WHERE u.id = s.user_id) = 'full_time'
  ) AS ft_count,
  COUNT(*) FILTER (
    WHERE s.cell_state = 'working'
    AND   (SELECT u.employment_type FROM users u WHERE u.id = s.user_id) = 'prn'
  ) AS prn_count,
  COUNT(*) FILTER (WHERE s.cell_state = 'working') AS total_count
FROM shifts s
GROUP BY s.schedule_block_id, s.shift_date;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE departments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_blocks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE preliminary_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_publish_edits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_requests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE prn_shift_interest       ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_thresholds      ENABLE ROW LEVEL SECURITY;

-- Phase 1: authenticated users can read/write all tables.
-- Refined per-role policies added in later phases.
CREATE POLICY "authenticated_all_departments"      ON departments              FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_users"            ON users                    FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_schedule_blocks"  ON schedule_blocks          FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_shifts"           ON shifts                   FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_op_entries"       ON operational_entries      FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_avail_subs"       ON availability_submissions FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_avail_entries"    ON availability_entries     FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_change_requests"  ON preliminary_change_requests FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_post_pub_edits"   ON post_publish_edits       FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_swap_requests"    ON swap_requests            FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_prn_interest"     ON prn_shift_interest       FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_coverage"         ON coverage_thresholds      FOR ALL USING (auth.uid() IS NOT NULL);

-- operational_entries is append-only: no DELETE allowed for anyone
CREATE POLICY "no_delete_op_entries" ON operational_entries FOR DELETE USING (false);
```

- [ ] **Step 3.2: Apply schema in Supabase dashboard**

Go to Supabase dashboard → SQL Editor → paste the full SQL above → Run.

Verify: go to Table Editor and confirm all 12 tables are visible.

- [ ] **Step 3.3: Generate TypeScript types**

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/types/database.types.ts
```

Replace `YOUR_PROJECT_ID` with the project ref from the Supabase dashboard URL.

- [ ] **Step 3.4: Commit**

```bash
git add supabase/ lib/types/
git commit -m "feat: add Supabase schema (all 12 tables, RLS, triggers, views)"
```

---

## Task 4: Seed Data

**Files:**
- Create: `supabase/seed.ts`

The seed creates: 1 department, 1 manager, 10 FT therapists (3 lead-qualified), 5 PRN therapists, 1 Day Shift 6-week block (final status), and all shift rows.

- [ ] **Step 4.1: Write `supabase/seed.ts`**

```typescript
// supabase/seed.ts
import { createClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const BLOCK_START = new Date('2026-03-01') // Sunday
const BLOCK_END   = addDays(BLOCK_START, 41) // Saturday April 11

// Generate array of all 42 dates in the block
const DATES = Array.from({ length: 42 }, (_, i) => addDays(BLOCK_START, i))

async function seed() {
  console.log('Seeding Teamwise test data...')

  // 1. Department
  const { data: dept, error: deptErr } = await supabase
    .from('departments')
    .insert({ name: 'Respiratory Therapy' })
    .select('id')
    .single()
  if (deptErr) throw deptErr
  const deptId = dept.id
  console.log('Department created:', deptId)

  // 2. Coverage thresholds
  await supabase.from('coverage_thresholds').insert([
    { department_id: deptId, shift_type: 'day',   minimum_staff: 3, ideal_staff: 4, maximum_staff: 5 },
    { department_id: deptId, shift_type: 'night',  minimum_staff: 3, ideal_staff: 4, maximum_staff: 5 },
  ])

  // 3. Create auth users + user rows
  // Manager
  const { data: managerAuth } = await supabase.auth.admin.createUser({
    email: 'manager@teamwise.dev',
    password: 'password123',
    email_confirm: true,
    user_metadata: { full_name: 'Alex Rivera', role: 'manager' },
  })
  const managerId = managerAuth.user!.id

  await supabase.from('users').insert({
    id: managerId,
    email: 'manager@teamwise.dev',
    full_name: 'Alex Rivera',
    role: 'manager',
    employment_type: 'full_time',
    is_lead_qualified: false,
    default_shift_type: 'day',
    department_id: deptId,
  })
  console.log('Manager created')

  // FT therapists — 10 total, 3 lead-qualified
  const ftTherapists = [
    { name: 'Jordan Smith',   email: 'jsmith@teamwise.dev',   lead: true,  shift: 'day' },
    { name: 'Casey Brown',    email: 'cbrown@teamwise.dev',   lead: true,  shift: 'day' },
    { name: 'Morgan Davis',   email: 'mdavis@teamwise.dev',   lead: true,  shift: 'day' },
    { name: 'Taylor Wilson',  email: 'twilson@teamwise.dev',  lead: false, shift: 'day' },
    { name: 'Avery Martinez', email: 'amartinez@teamwise.dev',lead: false, shift: 'day' },
    { name: 'Riley Johnson',  email: 'rjohnson@teamwise.dev', lead: false, shift: 'day' },
    { name: 'Quinn Lee',      email: 'qlee@teamwise.dev',     lead: false, shift: 'day' },
    { name: 'Drew Anderson',  email: 'danderson@teamwise.dev',lead: false, shift: 'day' },
    { name: 'Sage Thomas',    email: 'sthomas@teamwise.dev',  lead: false, shift: 'day' },
    { name: 'Blake Garcia',   email: 'bgarcia@teamwise.dev',  lead: false, shift: 'day' },
  ] as const

  const ftIds: string[] = []
  for (const t of ftTherapists) {
    const { data: auth } = await supabase.auth.admin.createUser({
      email: t.email, password: 'password123', email_confirm: true,
    })
    const uid = auth.user!.id
    await supabase.from('users').insert({
      id: uid, email: t.email, full_name: t.name,
      role: 'therapist', employment_type: 'full_time',
      is_lead_qualified: t.lead,
      default_shift_type: 'day' as const, department_id: deptId,
    })
    ftIds.push(uid)
  }
  console.log('FT therapists created:', ftIds.length)

  // PRN therapists — 5 total
  const prnTherapists = [
    { name: 'Sam Chen',    email: 'schen@teamwise.dev'    },
    { name: 'Jamie Patel', email: 'jpatel@teamwise.dev'   },
    { name: 'Reese Kim',   email: 'rkim@teamwise.dev'     },
    { name: 'Parker Obi',  email: 'pobi@teamwise.dev'     },
    { name: 'Cam Torres',  email: 'ctorres@teamwise.dev'  },
  ]

  const prnIds: string[] = []
  for (const t of prnTherapists) {
    const { data: auth } = await supabase.auth.admin.createUser({
      email: t.email, password: 'password123', email_confirm: true,
    })
    const uid = auth.user!.id
    await supabase.from('users').insert({
      id: uid, email: t.email, full_name: t.name,
      role: 'therapist', employment_type: 'prn',
      is_lead_qualified: false, default_shift_type: null, department_id: deptId,
    })
    prnIds.push(uid)
  }
  console.log('PRN therapists created:', prnIds.length)

  // 4. Schedule blocks — Day Shift AND Night Shift (roadmap DoD requires both grids from seeded data)
  const { data: dayBlock } = await supabase
    .from('schedule_blocks')
    .insert({
      department_id: deptId,
      shift_type: 'day',
      start_date: format(BLOCK_START, 'yyyy-MM-dd'),
      end_date: format(BLOCK_END, 'yyyy-MM-dd'),
      status: 'final',
      created_by: managerId,
      published_by: managerId,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  const dayBlockId = dayBlock!.id

  const { data: nightBlock } = await supabase
    .from('schedule_blocks')
    .insert({
      department_id: deptId,
      shift_type: 'night',
      start_date: format(BLOCK_START, 'yyyy-MM-dd'),
      end_date: format(BLOCK_END, 'yyyy-MM-dd'),
      status: 'final',
      created_by: managerId,
      published_by: managerId,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  const nightBlockId = nightBlock!.id
  console.log('Blocks created — Day:', dayBlockId, 'Night:', nightBlockId)

  // 5. Shift rows
  // FT pattern: each therapist works a realistic 3x12 pattern
  // We'll assign states so ~4 therapists work each day
  type ShiftRow = {
    schedule_block_id: string; user_id: string; shift_date: string;
    cell_state: 'working' | 'cannot_work' | 'off' | 'fmla'; lead_user_id: string | null
  }
  const shiftRows: ShiftRow[] = []

  // Lead-qualified IDs (first 3 FT)
  const [lead1, lead2, lead3] = ftIds

  // Helper: generate shift rows for one block
  function buildFTRows(blockId: string) {
    for (const [ui, userId] of ftIds.entries()) {
      for (const [di, date] of DATES.entries()) {
        const dateStr = format(date, 'yyyy-MM-dd')
        const dayInCycle = (di + ui * 3) % 7
        let state: 'working' | 'cannot_work' | 'off' | 'fmla' = 'off'
        if (dayInCycle < 3) state = 'working'
        else if (dayInCycle === 3 && ui === 0) state = 'cannot_work' // demo asterisk
        if (ui === 9 && di >= 14 && di <= 20) state = 'fmla'

        let leadUserId: string | null = null
        if (state === 'working') {
          if (userId === lead1) leadUserId = lead1
          else if (di % 7 < 3) leadUserId = di % 2 === 0 ? lead2 : lead3
        }
        shiftRows.push({ schedule_block_id: blockId, user_id: userId, shift_date: dateStr, cell_state: state, lead_user_id: leadUserId })
      }
    }
  }

  function buildPRNRows(blockId: string) {
    for (const [pi, userId] of prnIds.entries()) {
      for (const [di, date] of DATES.entries()) {
        const dateStr = format(date, 'yyyy-MM-dd')
        const dayOfWeek = date.getDay()
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
        let state: 'working' | 'off' = 'off'
        if (isWeekend && (di + pi) % 3 !== 0) state = 'working'
        if (!isWeekend && (di + pi) % 5 === 0) state = 'working'
        shiftRows.push({ schedule_block_id: blockId, user_id: userId, shift_date: dateStr, cell_state: state, lead_user_id: null })
      }
    }
  }

  // Build rows for both Day and Night blocks
  buildFTRows(dayBlockId)
  buildPRNRows(dayBlockId)
  buildFTRows(nightBlockId)
  buildPRNRows(nightBlockId)

  // Insert in batches of 200
  for (let i = 0; i < shiftRows.length; i += 200) {
    const batch = shiftRows.slice(i, i + 200)
    const { error } = await supabase.from('shifts').insert(batch)
    if (error) throw error
  }
  console.log(`Inserted ${shiftRows.length} shift rows (Day + Night blocks)`)

  console.log('\n✅ Seed complete!')
  console.log('Manager login: manager@teamwise.dev / password123')
  console.log('Therapist login: jsmith@teamwise.dev / password123')
}

seed().catch(console.error)
```

- [ ] **Step 4.2: Install ts-node for running the seed**

```bash
npm install -D ts-node
```

- [ ] **Step 4.3: Run the seed**

```bash
npm run seed
```

Expected output:
```
Department created: <uuid>
Manager created
FT therapists created: 10
PRN therapists created: 5
Block created: <uuid>
Inserted 630 shift rows
✅ Seed complete!
```

- [ ] **Step 4.4: Verify in Supabase dashboard**

Table Editor → shifts → confirm 630 rows. Filter by `cell_state = 'working'` and verify roughly 4 per day.

- [ ] **Step 4.5: Commit**

```bash
git add supabase/seed.ts
git commit -m "feat: add seed script (1 block, 10 FT + 5 PRN, 630 shift rows)"
```

---

## Task 5: Auth Provider Abstraction

**Files:**
- Create: `lib/auth.ts`
- Create: `tests/unit/auth.test.ts`

- [ ] **Step 5.1: Write failing unit test for auth module shape**

```typescript
// tests/unit/auth.test.ts
import { describe, it, expect, vi } from 'vitest'

// Mock Supabase clients before importing auth
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

describe('lib/auth', () => {
  it('exports signIn, signOut, getServerUser, onAuthStateChange', async () => {
    const auth = await import('@/lib/auth')
    expect(typeof auth.signIn).toBe('function')
    expect(typeof auth.signOut).toBe('function')
    expect(typeof auth.getServerUser).toBe('function')
    expect(typeof auth.onAuthStateChange).toBe('function')
  })

  it('signIn calls supabase.auth.signInWithPassword', async () => {
    const auth = await import('@/lib/auth')
    const result = await auth.signIn('test@test.com', 'pass123')
    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('error')
  })

  it('getServerUser returns user or null', async () => {
    const auth = await import('@/lib/auth')
    const user = await auth.getServerUser()
    expect(user).toBeNull() // mock returns null
  })
})
```

- [ ] **Step 5.2: Run test — expect FAIL (module doesn't exist)**

```bash
npm test tests/unit/auth.test.ts
```

Expected: `Error: Cannot find module '@/lib/auth'`

- [ ] **Step 5.3: Write `lib/auth.ts`**

```typescript
// lib/auth.ts
// The ONLY file in the codebase that calls Supabase Auth APIs.
// All other files import from here. Never import @supabase/ssr auth methods directly.
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { createClient as createServerClient } from '@/lib/supabase/server'

// ── Server-side ──────────────────────────────────────────────────────────────

/** Get the currently authenticated user (server component / route handler). */
export async function getServerUser(): Promise<User | null> {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// ── Client-side ──────────────────────────────────────────────────────────────

/** Sign in with email and password. */
export function signIn(email: string, password: string) {
  const supabase = createBrowserClient()
  return supabase.auth.signInWithPassword({ email, password })
}

/** Sign out the current session. */
export function signOut() {
  const supabase = createBrowserClient()
  return supabase.auth.signOut()
}

/** Subscribe to auth state changes (login/logout). Returns unsubscribe function. */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
) {
  const supabase = createBrowserClient()
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback)
  return () => subscription.unsubscribe()
}

// ── Admin (server-side, service role key) ────────────────────────────────────

/** Invite a new therapist by email. Server action only. */
export async function inviteUser(
  email: string,
  userData: {
    full_name: string
    role: 'manager' | 'therapist'
    employment_type: 'full_time' | 'prn'
    default_shift_type: 'day' | 'night' | null
  }
) {
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  return admin.auth.admin.inviteUserByEmail(email, { data: userData })
}
```

- [ ] **Step 5.4: Run test — expect PASS**

```bash
npm test tests/unit/auth.test.ts
```

Expected: all 3 tests PASS

- [ ] **Step 5.5: Commit**

```bash
git add lib/auth.ts tests/unit/auth.test.ts
git commit -m "feat: auth provider abstraction (lib/auth.ts)"
```

---

## Task 6: Auth Middleware & Login Page

**Files:**
- Create: `middleware.ts`
- Create: `app/(auth)/layout.tsx`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/page.tsx`
- Create: `tests/e2e/login.spec.ts`

- [ ] **Step 6.1: Write failing E2E test for login**

```typescript
// tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Login', () => {
  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/schedule')
    await expect(page).toHaveURL(/.*login/)
  })

  test('login page renders email and password fields', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('valid credentials redirect to /schedule', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('manager@teamwise.dev')
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/.*schedule/, { timeout: 5000 })
  })

  test('invalid credentials show error message', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('wrongpass')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
```

- [ ] **Step 6.2: Run E2E test — expect FAIL**

```bash
npm run test:e2e tests/e2e/login.spec.ts
```

Expected: all tests fail (pages don't exist yet)

- [ ] **Step 6.3: Write `middleware.ts`**

```typescript
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session (important — do not remove)
  const { data: { user } } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')

  if (!user && !isAuthRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/schedule', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons).*)',
  ],
}
```

- [ ] **Step 6.4: Write `app/page.tsx`** (root redirect)

```typescript
// app/page.tsx
import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/schedule')
}
```

- [ ] **Step 6.5: Write `app/(auth)/layout.tsx`**

```typescript
// app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Teamwise</h1>
          <p className="text-sm text-slate-500 mt-1">RT Scheduling</p>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 6.6: Write `app/(auth)/login/page.tsx`**

```typescript
// app/(auth)/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: signInError } = await signIn(email, password)

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    router.push('/schedule')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-8 rounded-xl shadow-sm border border-slate-200">
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="you@hospital.org"
          autoComplete="email"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          autoComplete="current-password"
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 6.7: Run E2E tests — expect PASS**

```bash
npm run test:e2e tests/e2e/login.spec.ts
```

Expected: all 4 login tests PASS

- [ ] **Step 6.8: Commit**

```bash
git add middleware.ts app/ tests/e2e/login.spec.ts
git commit -m "feat: login page, auth middleware, root redirect"
```

---

## Task 7: App Shell (Sidebar + TopBar)

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `components/shell/Sidebar.tsx`
- Create: `components/shell/TopBar.tsx`
- Create: `app/(app)/schedule/page.tsx` (stub — full grid in Task 8)

- [ ] **Step 7.1: Write `components/shell/Sidebar.tsx`**

```typescript
// components/shell/Sidebar.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Database } from '@/lib/types/database.types'

type UserRole = Database['public']['Tables']['users']['Row']['role']

interface NavItem {
  href: string
  label: string
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/schedule',     label: 'Schedule',        roles: ['manager', 'therapist'] },
  { href: '/availability', label: 'Availability',    roles: ['manager', 'therapist'] },
  { href: '/swaps',        label: 'Swaps',           roles: ['manager', 'therapist'] },
  { href: '/coverage',     label: 'Coverage',        roles: ['manager'] },
  { href: '/staff',        label: 'Staff',           roles: ['manager'] },
  { href: '/settings',     label: 'Settings',        roles: ['manager'] },
  { href: '/open-shifts',  label: 'Open Shifts',     roles: ['therapist'] },
  { href: '/change-requests', label: 'Change Requests', roles: ['therapist'] },
]

interface Props {
  role: UserRole
}

export function Sidebar({ role }: Props) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter(item => item.roles.includes(role))

  return (
    <aside className="
      fixed top-0 left-0 h-full z-20 bg-white border-r border-slate-200
      w-56 xl:w-56 lg:w-14 flex flex-col
    ">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-slate-200 shrink-0">
        <span className="font-bold text-slate-900 xl:block lg:hidden">Teamwise</span>
        <span className="font-bold text-slate-900 hidden lg:block xl:hidden">TW</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {items.map(item => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center h-10 px-4 text-sm gap-3 rounded-md mx-2 transition-colors',
                active
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <span className="xl:inline lg:hidden">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 7.2: Write `components/shell/TopBar.tsx`**

```typescript
// components/shell/TopBar.tsx
'use client'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { signOut } from '@/lib/auth'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  user: Pick<UserRow, 'full_name' | 'role'>
}

export function TopBar({ user }: Props) {
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
      <div className="flex-1" />
      <span className="text-sm font-medium text-slate-700">{user.full_name}</span>
      <Badge variant={user.role === 'manager' ? 'default' : 'secondary'}>
        {user.role === 'manager' ? 'Manager' : 'Therapist'}
      </Badge>
      {/* Notification dot — wired in Phase 3 */}
      <div className="w-2 h-2 rounded-full bg-transparent" aria-hidden />
      <button
        onClick={handleSignOut}
        className="text-sm text-slate-500 hover:text-slate-700 ml-2"
      >
        Sign out
      </button>
    </header>
  )
}
```

- [ ] **Step 7.3: Write `app/(app)/layout.tsx`**

```typescript
// app/(app)/layout.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar role={profile.role} />
      <div className="flex flex-col flex-1 min-w-0 lg:pl-14 xl:pl-56">
        <TopBar user={profile} />
        <main className="flex-1 overflow-auto p-4">
          {children}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 7.4: Write stub `app/(app)/schedule/page.tsx`**

```typescript
// app/(app)/schedule/page.tsx (stub — replaced in Task 8)
export default function SchedulePage() {
  return <div className="text-slate-500 text-sm">Schedule grid loading…</div>
}
```

- [ ] **Step 7.5: Run dev server and manually verify**

```bash
npm run dev
```

- Navigate to `http://localhost:3000` → should redirect to `/login`
- Log in as `manager@teamwise.dev / password123`
- Verify: sidebar shows Schedule, Availability, Swaps, Coverage, Staff, Settings
- Log out → verify redirects to `/login`
- Log in as `jsmith@teamwise.dev / password123`
- Verify: therapist sidebar (no Coverage, Staff, Settings; shows Change Requests)

- [ ] **Step 7.6: Commit**

```bash
git add app/(app)/ components/shell/
git commit -m "feat: app shell with role-aware sidebar and topbar"
```

---

## Task 8: Calendar Grid

**Files:**
- Create: `components/schedule/ScheduleGrid.tsx`
- Create: `components/schedule/GridCell.tsx`
- Create: `components/schedule/ShiftToggle.tsx`
- Modify: `app/(app)/schedule/page.tsx`
- Create: `tests/unit/cell-state.test.ts`
- Create: `tests/e2e/grid.spec.ts`
- Create: `app/globals.css` additions (CSS custom properties)

- [ ] **Step 8.1: Write failing unit test for cell state → class logic**

```typescript
// tests/unit/cell-state.test.ts
import { describe, it, expect } from 'vitest'
import { cellStateClass, cellStateLabel } from '@/lib/schedule/cell-state'

describe('cellStateClass', () => {
  it('working → bg-[var(--shift-color)]', () => {
    expect(cellStateClass('working')).toContain('bg-[var(--shift-color)]')
  })
  it('cannot_work → asterisk/gray', () => {
    expect(cellStateClass('cannot_work')).toContain('bg-slate-100')
  })
  it('off → empty/transparent', () => {
    expect(cellStateClass('off')).toContain('bg-transparent')
  })
  it('fmla → distinct background', () => {
    expect(cellStateClass('fmla')).toContain('bg-amber-50')
  })
})

describe('cellStateLabel', () => {
  it('cannot_work → *', () => {
    expect(cellStateLabel('cannot_work')).toBe('*')
  })
  it('working → 1', () => {
    expect(cellStateLabel('working')).toBe('1')
  })
  it('fmla → FMLA', () => {
    expect(cellStateLabel('fmla')).toBe('FMLA')
  })
  it('off → empty string', () => {
    expect(cellStateLabel('off')).toBe('')
  })
})
```

- [ ] **Step 8.2: Run test — expect FAIL**

```bash
npm test tests/unit/cell-state.test.ts
```

Expected: `Cannot find module '@/lib/schedule/cell-state'`

- [ ] **Step 8.3: Write `lib/schedule/cell-state.ts`**

```typescript
// lib/schedule/cell-state.ts
import type { Database } from '@/lib/types/database.types'

type CellState = Database['public']['Tables']['shifts']['Row']['cell_state']

export function cellStateClass(state: CellState): string {
  switch (state) {
    case 'working':      return 'bg-[var(--shift-color)] text-white font-medium'
    case 'cannot_work':  return 'bg-slate-100 text-slate-400'
    case 'off':          return 'bg-transparent text-transparent'
    case 'fmla':         return 'bg-amber-50 text-amber-700 text-[10px] font-semibold'
  }
}

export function cellStateLabel(state: CellState): string {
  switch (state) {
    case 'working':     return '1'
    case 'cannot_work': return '*'
    case 'fmla':        return 'FMLA'
    case 'off':         return ''
  }
}
```

- [ ] **Step 8.4: Run test — expect PASS**

```bash
npm test tests/unit/cell-state.test.ts
```

Expected: all 8 tests PASS

- [ ] **Step 8.5: Add CSS custom properties to `app/globals.css`**

Add at the end of the existing globals.css:

```css
/* Teamwise schedule grid */
.schedule-grid {
  --shift-color: theme('colors.blue.500');       /* Day shift default */
  --shift-color-muted: theme('colors.blue.100');
}

.schedule-grid[data-shift="night"] {
  --shift-color: theme('colors.violet.500');
  --shift-color-muted: theme('colors.violet.100');
}

/* Grid column template shared by all rows */
.grid-row {
  display: grid;
  grid-template-columns: 160px repeat(42, minmax(28px, 1fr));
}

/* Sticky first column (therapist name) */
.grid-cell-name {
  position: sticky;
  left: 0;
  z-index: 1;
  background: white;
}
```

- [ ] **Step 8.6: Write `components/schedule/GridCell.tsx`**

```typescript
// components/schedule/GridCell.tsx
import { cn } from '@/lib/utils'
import { cellStateClass, cellStateLabel } from '@/lib/schedule/cell-state'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']

interface Props {
  shift: Shift | undefined  // undefined = off (no row in DB)
  onClick: (shift: Shift | undefined, date: string) => void
  date: string
}

export function GridCell({ shift, onClick, date }: Props) {
  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id

  return (
    <button
      onClick={() => onClick(shift, date)}
      className={cn(
        'relative h-9 text-xs flex items-center justify-center border border-white/20',
        'transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-slate-400',
        cellStateClass(state)
      )}
      aria-label={`${date}: ${state}`}
    >
      {cellStateLabel(state)}
      {/* Lead badge */}
      {isLead && state === 'working' && (
        <span
          className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400"
          title="Lead/charge"
        />
      )}
    </button>
  )
}
```

- [ ] **Step 8.7: Write `components/schedule/ShiftToggle.tsx`**

```typescript
// components/schedule/ShiftToggle.tsx
'use client'
import { useState } from 'react'

interface Props {
  defaultShift: 'day' | 'night'
  onToggle: (shift: 'day' | 'night') => void
}

export function ShiftToggle({ defaultShift, onToggle }: Props) {
  const [active, setActive] = useState<'day' | 'night'>(defaultShift)

  function toggle(shift: 'day' | 'night') {
    setActive(shift)
    onToggle(shift)
  }

  return (
    <div className="flex rounded-lg border border-slate-200 p-0.5 bg-white w-fit">
      {(['day', 'night'] as const).map(s => (
        <button
          key={s}
          onClick={() => toggle(s)}
          className={
            active === s
              ? 'px-4 py-1.5 text-sm font-medium rounded-md bg-slate-900 text-white'
              : 'px-4 py-1.5 text-sm text-slate-600 hover:text-slate-900'
          }
        >
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  )
}
```

> **Note on headcount computation:** The schema includes a `shift_planned_headcount` view (Task 3). In Phase 1, headcount is computed client-side in `ScheduleGrid` using the already-fetched shifts array — this avoids an extra round-trip and is acceptable for Phase 1 scale (~630 rows). In Phase 2, the roadmap requires server-side headcount via that view. This client-side implementation will be replaced then.

- [ ] **Step 8.8: Write `components/schedule/ScheduleGrid.tsx`**

```typescript
// components/schedule/ScheduleGrid.tsx
'use client'
import { useState } from 'react'
import { format, addDays, startOfWeek } from 'date-fns'
import { GridCell } from './GridCell'
import { ShiftToggle } from './ShiftToggle'
import { CellPanel } from './CellPanel'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  block: Database['public']['Tables']['schedule_blocks']['Row']
  shifts: Shift[]
  therapists: UserRow[]
  defaultShiftType: 'day' | 'night'
}

// Build array of 42 date strings from block start
function buildDates(startDate: string): string[] {
  const start = new Date(startDate + 'T00:00:00')
  return Array.from({ length: 42 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

// Build week groups of 7 dates each
function buildWeeks(dates: string[]): string[][] {
  return Array.from({ length: 6 }, (_, i) => dates.slice(i * 7, i * 7 + 7))
}

export function ScheduleGrid({ block, shifts, therapists, defaultShiftType }: Props) {
  const [activeShift, setActiveShift] = useState<'day' | 'night'>(defaultShiftType)
  const [panelShift, setPanelShift] = useState<Shift | undefined>()
  const [panelDate, setPanelDate] = useState<string>('')
  const [panelUser, setPanelUser] = useState<UserRow | undefined>()
  const [panelOpen, setPanelOpen] = useState(false)

  const dates = buildDates(block.start_date)
  const weeks = buildWeeks(dates)

  const ftTherapists = therapists.filter(t => t.employment_type === 'full_time')
  const prnTherapists = therapists.filter(t => t.employment_type === 'prn')

  // Index shifts by userId + date for O(1) lookup
  const shiftIndex = new Map<string, Shift>()
  for (const s of shifts) {
    shiftIndex.set(`${s.user_id}:${s.shift_date}`, s)
  }

  function getShift(userId: string, date: string): Shift | undefined {
    return shiftIndex.get(`${userId}:${date}`)
  }

  function handleCellClick(shift: Shift | undefined, date: string, user: UserRow) {
    setPanelShift(shift)
    setPanelDate(date)
    setPanelUser(user)
    setPanelOpen(true)
  }

  // Headcount helpers
  function ftCount(date: string): number {
    return ftTherapists.filter(t => getShift(t.id, date)?.cell_state === 'working').length
  }
  function prnCount(date: string): number {
    return prnTherapists.filter(t => getShift(t.id, date)?.cell_state === 'working').length
  }
  function headcountClass(n: number): string {
    if (n < 3) return 'text-red-600 font-bold'
    if (n === 3) return 'text-yellow-600 font-semibold'
    return 'text-green-600 font-semibold'
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <ShiftToggle defaultShift={defaultShiftType} onToggle={setActiveShift} />
        <span className="text-sm text-slate-500">
          {format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} –{' '}
          {format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
          {block.status.replace('_', ' ')}
        </span>
      </div>

      {/* Grid — horizontal scroll on small screens */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div
          className="schedule-grid min-w-max"
          data-shift={activeShift}
          style={{ '--shift-color': activeShift === 'day' ? '#3b82f6' : '#8b5cf6' } as React.CSSProperties}
        >
          {/* ── HEADER ── */}
          {/* Week row */}
          <div className="grid-row bg-slate-50 border-b border-slate-200">
            <div className="grid-cell-name px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Staff
            </div>
            {weeks.map((week, wi) => (
              <div
                key={wi}
                className="col-span-7 text-center text-xs text-slate-500 py-1 border-l border-slate-200 first:border-l-0"
              >
                {format(new Date(week[0] + 'T00:00:00'), 'MMM d')} –{' '}
                {format(new Date(week[6] + 'T00:00:00'), 'MMM d')}
              </div>
            ))}
          </div>

          {/* Day letter row */}
          <div className="grid-row bg-slate-50 border-b border-slate-200">
            <div className="grid-cell-name" />
            {dates.map(d => (
              <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-0.5">
                {format(new Date(d + 'T00:00:00'), 'EEEEE')}
              </div>
            ))}
          </div>

          {/* Date number row */}
          <div className="grid-row bg-slate-50 border-b border-slate-200">
            <div className="grid-cell-name" />
            {dates.map(d => (
              <div key={d} className="text-center text-[10px] text-slate-500 pb-1">
                {format(new Date(d + 'T00:00:00'), 'd')}
              </div>
            ))}
          </div>

          {/* ── FT SECTION ── */}
          <div className="grid-row bg-blue-50/30">
            <div className="grid-cell-name px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide col-span-full">
              Full-Time
            </div>
          </div>

          {ftTherapists.map(therapist => (
            <div key={therapist.id} className="grid-row hover:bg-slate-50/50 group">
              <div className="grid-cell-name px-2 py-1 flex items-center gap-1 border-r border-slate-200">
                <span className="text-xs text-slate-700 truncate">{therapist.full_name}</span>
                {therapist.is_lead_qualified && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" title="Lead-qualified" />
                )}
              </div>
              {dates.map(date => (
                <GridCell
                  key={date}
                  shift={getShift(therapist.id, date)}
                  date={date}
                  onClick={(shift, d) => handleCellClick(shift, d, therapist)}
                />
              ))}
            </div>
          ))}

          {/* FT Count row */}
          <div className="grid-row bg-slate-50 border-y border-slate-200">
            <div className="grid-cell-name px-2 py-1 text-[10px] font-semibold text-slate-500 border-r border-slate-200">
              FT Count
            </div>
            {dates.map(date => {
              const n = ftCount(date)
              return (
                <div key={date} className={`text-center text-[10px] py-1 ${headcountClass(n)}`}>
                  {n}
                </div>
              )
            })}
          </div>

          {/* ── PRN SECTION ── */}
          <div className="grid-row bg-violet-50/30">
            <div className="grid-cell-name px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide col-span-full">
              PRN
            </div>
          </div>

          {prnTherapists.map(therapist => (
            <div key={therapist.id} className="grid-row hover:bg-slate-50/50">
              <div className="grid-cell-name px-2 py-1 flex items-center border-r border-slate-200">
                <span className="text-xs text-slate-700 truncate">{therapist.full_name}</span>
              </div>
              {dates.map(date => (
                <GridCell
                  key={date}
                  shift={getShift(therapist.id, date)}
                  date={date}
                  onClick={(shift, d) => handleCellClick(shift, d, therapist)}
                />
              ))}
            </div>
          ))}

          {/* PRN Count row */}
          <div className="grid-row bg-slate-50 border-y border-slate-200">
            <div className="grid-cell-name px-2 py-1 text-[10px] font-semibold text-slate-500 border-r border-slate-200">
              PRN Count
            </div>
            {dates.map(date => {
              const n = prnCount(date)
              return (
                <div key={date} className={`text-center text-[10px] py-1 ${headcountClass(n)}`}>
                  {n}
                </div>
              )
            })}
          </div>

          {/* ── TOTAL ROW ── */}
          <div className="grid-row bg-slate-100 border-b border-slate-200">
            <div className="grid-cell-name px-2 py-1 text-[10px] font-bold text-slate-600 border-r border-slate-200">
              Total
            </div>
            {dates.map(date => {
              const n = ftCount(date) + prnCount(date)
              return (
                <div key={date} className={`text-center text-[10px] py-1 font-bold ${headcountClass(n)}`}>
                  {n}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Cell panel */}
      <CellPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        shift={panelShift}
        date={panelDate}
        user={panelUser}
      />
    </div>
  )
}
```

- [ ] **Step 8.9: Write schedule page with real data fetch**

```typescript
// app/(app)/schedule/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ScheduleGrid } from '@/components/schedule/ScheduleGrid'

export default async function SchedulePage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  // Get user profile for default shift type
  const { data: profile } = await supabase
    .from('users')
    .select('default_shift_type, department_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Default shift type: auto-route by profile, fall back to 'day'
  const defaultShift = (profile.default_shift_type ?? 'day') as 'day' | 'night'

  // Get current/most recent final block for user's department
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id!)
    .eq('shift_type', defaultShift)
    .in('status', ['final', 'active', 'preliminary'])
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  if (!block) {
    return (
      <div className="text-slate-500 text-sm p-8">
        No schedule found. Ask your manager to create a block.
      </div>
    )
  }

  // Get all shifts for this block
  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('schedule_block_id', block.id)

  // Get all therapists in department
  const { data: therapists } = await supabase
    .from('users')
    .select('*')
    .eq('department_id', profile.department_id!)
    .eq('role', 'therapist')
    .order('employment_type', { ascending: true }) // FT first
    .order('full_name', { ascending: true })

  return (
    <ScheduleGrid
      block={block}
      shifts={shifts ?? []}
      therapists={therapists ?? []}
      defaultShiftType={defaultShift}
    />
  )
}
```

- [ ] **Step 8.10: Write E2E grid tests**

```typescript
// tests/e2e/grid.spec.ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@teamwise.dev')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/.*schedule/)
})

test('schedule grid shows FT and PRN sections', async ({ page }) => {
  await expect(page.getByText('Full-Time')).toBeVisible()
  await expect(page.getByText('PRN')).toBeVisible()
})

test('grid shows FT Count and PRN Count rows', async ({ page }) => {
  await expect(page.getByText('FT Count')).toBeVisible()
  await expect(page.getByText('PRN Count')).toBeVisible()
  await expect(page.getByText('Total')).toBeVisible()
})

test('Day/Night toggle switches grids', async ({ page }) => {
  await page.getByRole('button', { name: 'Night' }).click()
  // Night shift button should be active (dark background)
  const nightBtn = page.getByRole('button', { name: 'Night' })
  await expect(nightBtn).toHaveClass(/bg-slate-900/)
})

test('grid does not overflow at 1440px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const grid = page.locator('.schedule-grid')
  await expect(grid).toBeVisible()
  const box = await grid.boundingBox()
  expect(box?.width).toBeLessThanOrEqual(1440)
})
```

- [ ] **Step 8.11: Run unit and E2E tests**

```bash
npm test tests/unit/cell-state.test.ts
npm run test:e2e tests/e2e/grid.spec.ts
```

Expected: all tests PASS

- [ ] **Step 8.12: Commit**

```bash
git add components/schedule/ScheduleGrid.tsx components/schedule/GridCell.tsx \
  components/schedule/ShiftToggle.tsx app/(app)/schedule/ \
  lib/schedule/ app/globals.css tests/
git commit -m "feat: Day/Night calendar grid with FT/PRN sections and count rows"
```

---

## Task 9: Cell Slide-out Panel

**Files:**
- Create: `components/schedule/CellPanel.tsx`
- Create: `tests/e2e/cell-panel.spec.ts`

The panel is display-only in Phase 1 — it shows name, date, and cell state. Action buttons added in later phases.

- [ ] **Step 9.1: Write failing E2E test**

```typescript
// tests/e2e/cell-panel.spec.ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@teamwise.dev')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/.*schedule/)
})

test('clicking a Working cell opens the panel', async ({ page }) => {
  // Click the first Working (blue) cell in the grid
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('panel shows therapist name, date, and cell state', async ({ page }) => {
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Panel should show a name and date
  await expect(dialog.locator('text=/Working|Cannot Work|Off|FMLA/i')).toBeVisible()
})

test('panel closes on X button click', async ({ page }) => {
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /close/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('panel does not cover the full grid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  const panel = page.getByRole('dialog')
  const box = await panel.boundingBox()
  // Panel should take at most 40% of the viewport width
  expect(box?.width).toBeLessThan(1440 * 0.4)
})

test('panel works at mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
```

- [ ] **Step 9.2: Run E2E test — expect FAIL**

```bash
npm run test:e2e tests/e2e/cell-panel.spec.ts
```

Expected: tests fail (CellPanel not yet implemented)

- [ ] **Step 9.3: Write `components/schedule/CellPanel.tsx`**

```typescript
// components/schedule/CellPanel.tsx
'use client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

const STATE_LABELS: Record<string, string> = {
  working:      'Working',
  cannot_work:  'Cannot Work',
  off:          'Off',
  fmla:         'FMLA',
}

const STATE_COLORS: Record<string, string> = {
  working:      'default',
  cannot_work:  'secondary',
  off:          'outline',
  fmla:         'secondary',
}

interface Props {
  open: boolean
  onClose: () => void
  shift: Shift | undefined
  date: string
  user: UserRow | undefined
}

export function CellPanel({ open, onClose, shift, date, user }: Props) {
  if (!user || !date) return null

  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id

  const formattedDate = date
    ? format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')
    : ''

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent
        side="right"
        className="w-80 sm:w-96"
        aria-label="Cell details"
      >
        <SheetHeader>
          <SheetTitle className="text-left">{user.full_name}</SheetTitle>
          <p className="text-sm text-slate-500">{formattedDate}</p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Cell state */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <Badge variant={STATE_COLORS[state] as 'default' | 'secondary' | 'outline'}>
              {STATE_LABELS[state]}
            </Badge>
          </div>

          {/* Lead assignment */}
          {state === 'working' && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Lead / Charge</span>
              {isLead ? (
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                  Assigned ✓
                </Badge>
              ) : (
                <span className="text-sm text-slate-400">Not assigned</span>
              )}
            </div>
          )}

          {/* Employment type */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Type</span>
            <span className="text-sm text-slate-500 capitalize">
              {user.employment_type.replace('_', '-')}
            </span>
          </div>

          {/* Lead-qualified badge */}
          {user.is_lead_qualified && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Lead-qualified</span>
              <Badge variant="outline" className="text-blue-600 border-blue-200">Yes</Badge>
            </div>
          )}

          {/* Phase 1 note */}
          <p className="text-xs text-slate-400 mt-8 pt-4 border-t border-slate-100">
            Actions available in Phase 2 (cell editing) and beyond.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 9.4: Run E2E tests — expect PASS**

```bash
npm run test:e2e tests/e2e/cell-panel.spec.ts
```

Expected: all 5 tests PASS. Panel opens within 200ms of click, doesn't cover full grid, works on mobile.

- [ ] **Step 9.5: Commit**

```bash
git add components/schedule/CellPanel.tsx tests/e2e/cell-panel.spec.ts
git commit -m "feat: cell slide-out panel (display-only, Phase 1)"
```

---

## Task 10: PWA Foundation

**Files:**
- Modify: `next.config.js`
- Create: `public/manifest.json`
- Create: `public/icons/` (placeholder icons)
- Modify: `app/layout.tsx`

- [ ] **Step 10.1: Configure next-pwa in `next.config.js`**

```javascript
// next.config.js
const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14 settings
}

module.exports = withPWA(nextConfig)
```

- [ ] **Step 10.2: Create `public/manifest.json`**

```json
{
  "name": "Teamwise",
  "short_name": "Teamwise",
  "description": "RT Department Scheduling",
  "start_url": "/schedule",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#0f172a",
  "orientation": "any",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 10.3: Create placeholder icons**

Create two simple colored PNG placeholders (192x192 and 512x512). The easiest way on any system:

```bash
# Using Node canvas or any image tool
# Placeholder: create a simple dark square PNG
node -e "
const { createCanvas } = require('canvas');
const fs = require('fs');
['192', '512'].forEach(size => {
  const c = createCanvas(+size, +size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, +size, +size);
  ctx.fillStyle = '#ffffff';
  ctx.font = \`bold \${+size/4}px sans-serif\`;
  ctx.textAlign = 'center';
  ctx.fillText('TW', +size/2, +size/1.6);
  fs.writeFileSync(\`public/icons/icon-\${size}.png\`, c.toBuffer('image/png'));
});
"
```

If `canvas` module isn't available, create the `public/icons/` folder and add any 192×192 and 512×512 PNG files (can be placeholders from any source — they just need to exist for the Lighthouse PWA audit to pass).

- [ ] **Step 10.4: Add manifest link to `app/layout.tsx`**

```typescript
// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Teamwise',
  description: 'RT Department Scheduling',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Teamwise',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

- [ ] **Step 10.5: Create PWA offline fallback page**

```typescript
// app/offline/page.tsx
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <h1 className="text-xl font-bold text-slate-900 mb-2">You're offline</h1>
        <p className="text-sm text-slate-500">
          Teamwise requires a connection. Please check your network and try again.
        </p>
      </div>
    </div>
  )
}
```

Update `next.config.js` workboxOptions to point to the fallback:

```javascript
workboxOptions: {
  disableDevLogs: true,
  fallbacks: {
    document: '/offline',
  },
},
```

- [ ] **Step 10.6: Build and run Lighthouse PWA audit**

```bash
npm run build
npm run start
# In Chrome: DevTools → Lighthouse → PWA category → Analyze
```

Expected: PWA audit passes (installable, has manifest, icons, theme color).

- [ ] **Step 10.7: Final commit**

```bash
git add next.config.js public/ app/layout.tsx app/offline/
git commit -m "feat: PWA foundation (manifest, service worker, offline fallback, installable)"
```

---

## Phase 1 Definition of Done

Before marking Phase 1 complete, verify every item:

- [ ] Manager logs in → sees Day Shift grid → all FT and PRN rows render from seeded data
- [ ] Grid FT/PRN sections visible with correct row headers and count rows
- [ ] Day/Night toggle works (color changes, appropriate grid loads)
- [ ] Clicking any cell opens slide-out panel within 200ms
- [ ] Panel shows staff name, date, and current cell state
- [ ] Panel closes on X or outside click
- [ ] Therapist logs in → sees different sidebar nav than manager
- [ ] App is installable from Chrome (PWA)
- [ ] Grid does not overflow at 1440px viewport
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] All Vitest unit tests pass (`npm test`)
- [ ] All Playwright E2E tests pass (`npm run test:e2e`)
- [ ] No schema changes needed to support Phase 2 (verify against PRD section 11)

---

*Teamwise Phase 1 Plan — March 22, 2026 — companion to PRD v5.2 and Build Roadmap v1.0*
