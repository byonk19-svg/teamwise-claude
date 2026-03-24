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
      preliminary_change_requests: {
        Row: {
          id: string
          schedule_block_id: string
          requester_id: string
          shift_id: string
          request_type: 'move_shift' | 'mark_off' | 'other'
          note: string | null
          status: 'pending' | 'accepted' | 'rejected'
          response_note: string | null
          created_at: string
          actioned_at: string | null
          actioned_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['preliminary_change_requests']['Row'],
          'id' | 'created_at'
        >
        Update: Partial<
          Database['public']['Tables']['preliminary_change_requests']['Insert']
        >
      }
      prn_shift_interest: {
        Row: {
          id: string
          user_id: string
          shift_id: string
          status: 'pending' | 'confirmed' | 'declined'
          outside_availability: boolean
          submitted_at: string
          actioned_at: string | null
          actioned_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['prn_shift_interest']['Row'],
          'id' | 'submitted_at'
        >
        Update: Partial<
          Database['public']['Tables']['prn_shift_interest']['Insert']
        >
      }
      swap_requests: {
        Row: {
          id: string
          schedule_block_id: string
          requester_id: string
          requester_shift_id: string
          partner_id: string
          partner_shift_id: string
          is_cross_shift: boolean
          status: 'pending' | 'approved' | 'rejected' | 'expired'
          expires_at: string
          request_note: string | null
          response_note: string | null
          created_at: string
          actioned_at: string | null
          actioned_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['swap_requests']['Row'],
          'id' | 'created_at'
        >
        Update: Partial<
          Database['public']['Tables']['swap_requests']['Insert']
        >
      }
      operational_entries: {
        Row: {
          id: string
          schedule_block_id: string
          shift_id: string
          user_id: string
          entry_date: string
          entry_type: 'OC' | 'CI' | 'CX' | 'LE'
          note: string | null
          is_backfill: boolean
          entered_by: string
          entered_at: string
          removed_at: string | null
          removed_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['operational_entries']['Row'],
          'id' | 'entered_at'
        >
        Update: Partial<
          Database['public']['Tables']['operational_entries']['Insert']
        >
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
      shift_actual_headcount: {
        Row: {
          schedule_block_id: string
          shift_date: string
          ft_planned: number
          prn_planned: number
          total_planned: number
          ft_actual: number
          prn_actual: number
          total_actual: number
        }
      }
    }
    Functions: {
      assign_lead: {
        Args: {
          p_schedule_block_id: string
          p_shift_date: string
          p_lead_user_id: string | null
        }
        Returns: { success?: boolean; error?: string }
      }
      enter_operational_code: {
        Args: {
          p_schedule_block_id: string
          p_shift_id: string
          p_entry_type: 'OC' | 'CI' | 'CX' | 'LE'
          p_note?: string | null
        }
        Returns: { success?: boolean; error?: string }
      }
      remove_operational_code: {
        Args: { p_entry_id: string }
        Returns: { success?: boolean; error?: string }
      }
      revert_to_final: {
        Args: { p_schedule_block_id: string }
        Returns: { success?: boolean; error?: string }
      }
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
