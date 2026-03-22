# Supabase Migrations

## Applying the Schema

1. Go to your Supabase project dashboard → SQL Editor
2. Paste the contents of `001_initial_schema.sql` and run
3. Verify all 12 tables are visible in the Table Editor
4. After applying, regenerate TypeScript types:
   ```
   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/types/database.types.ts
   ```
