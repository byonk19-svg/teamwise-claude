// lib/types/database.types.ts
// Manual stub — replace with: npx supabase gen types typescript --project-id jcvlmwsiiikifdvaufqz

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
      departments: {
        Row: { id: string; name: string; created_at: string }
        Insert: Omit<Database['public']['Tables']['departments']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['departments']['Insert']>
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
      availability_submissions: {
        Row: {
          id: string
          schedule_block_id: string
          user_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['availability_submissions']['Row'], 'id' | 'submitted_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['availability_submissions']['Insert']>
      }
      availability_entries: {
        Row: {
          id: string
          submission_id: string
          entry_date: string
          entry_type: 'cannot_work' | 'requesting_to_work' | 'available_day' | 'available_night' | 'available_either'
          note: string | null
        }
        Insert: Omit<Database['public']['Tables']['availability_entries']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['availability_entries']['Insert']>
      }
    }
    Views: {
      shift_planned_headcount: {
        Row: {
          schedule_block_id: string
          shift_date: string
          ft_count: number
          prn_count: number
          total_count: number
        }
      }
    }
    Functions: {
      copy_block: {
        Args: { source_block_id: string; new_block_id: string }
        Returns: void
      }
      get_constraint_diff: {
        Args: { p_new_block_id: string }
        Returns: Array<{
          user_id: string
          full_name: string
          shift_date: string
          prior_cell_state: string
          avail_entry_type: string
        }>
      }
    }
    Enums: Record<string, never>
  }
}
