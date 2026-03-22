// lib/types/database.types.ts
// Manual stub — replace with: npx supabase gen types typescript --project-id YOUR_ID
// after applying the schema in Task 3.

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
