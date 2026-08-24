export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      documents: {
        Row: {
          created_at: string
          id: string
          kind: string
          label: string | null
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          label?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      education_qualifications: {
        Row: {
          board_university: string | null
          created_at: string
          discipline: string | null
          id: string
          institution: string | null
          level: Database["public"]["Enums"]["qualification_level"]
          percentage: number | null
          updated_at: string
          user_id: string
          year_of_passing: number | null
        }
        Insert: {
          board_university?: string | null
          created_at?: string
          discipline?: string | null
          id?: string
          institution?: string | null
          level: Database["public"]["Enums"]["qualification_level"]
          percentage?: number | null
          updated_at?: string
          user_id: string
          year_of_passing?: number | null
        }
        Update: {
          board_university?: string | null
          created_at?: string
          discipline?: string | null
          id?: string
          institution?: string | null
          level?: Database["public"]["Enums"]["qualification_level"]
          percentage?: number | null
          updated_at?: string
          user_id?: string
          year_of_passing?: number | null
        }
        Relationships: []
      }
      exam_attempts: {
        Row: {
          applied_at: string | null
          created_at: string
          custom_name: string | null
          exam_date: string | null
          exam_id: string | null
          id: string
          notes: string | null
          result_date: string | null
          roll_number: string | null
          score: number | null
          stage: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          custom_name?: string | null
          exam_date?: string | null
          exam_id?: string | null
          id?: string
          notes?: string | null
          result_date?: string | null
          roll_number?: string | null
          score?: number | null
          stage?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          custom_name?: string | null
          exam_date?: string | null
          exam_id?: string | null
          id?: string
          notes?: string | null
          result_date?: string | null
          roll_number?: string | null
          score?: number | null
          stage?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_update_details: {
        Row: {
          body: string | null
          download_links: Json | null
          exam_update_id: string
          important_dates: Json | null
          overview: Json | null
          raw: Json | null
          related_articles: Json | null
          sections: Json | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          download_links?: Json | null
          exam_update_id: string
          important_dates?: Json | null
          overview?: Json | null
          raw?: Json | null
          related_articles?: Json | null
          sections?: Json | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          download_links?: Json | null
          exam_update_id?: string
          important_dates?: Json | null
          overview?: Json | null
          raw?: Json | null
          related_articles?: Json | null
          sections?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_update_details_exam_update_id_fkey"
            columns: ["exam_update_id"]
            isOneToOne: true
            referencedRelation: "exam_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_updates: {
        Row: {
          category: Database["public"]["Enums"]["update_category"]
          created_at: string
          dedupe_key: string | null
          exam_id: string | null
          id: string
          is_published: boolean
          job_id: string | null
          job_link_state: Database["public"]["Enums"]["job_link_state"]
          organization_id: string | null
          published_at: string | null
          published_date: string | null
          scraped_at: string
          search_vector: unknown
          slug: string
          source_url: string
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["update_category"]
          created_at?: string
          dedupe_key?: string | null
          exam_id?: string | null
          id?: string
          is_published?: boolean
          job_id?: string | null
          job_link_state?: Database["public"]["Enums"]["job_link_state"]
          organization_id?: string | null
          published_at?: string | null
          published_date?: string | null
          scraped_at?: string
          search_vector?: unknown
          slug: string
          source_url: string
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["update_category"]
          created_at?: string
          dedupe_key?: string | null
          exam_id?: string | null
          id?: string
          is_published?: boolean
          job_id?: string | null
          job_link_state?: Database["public"]["Enums"]["job_link_state"]
          organization_id?: string | null
          published_at?: string | null
          published_date?: string | null
          scraped_at?: string
          search_vector?: unknown
          slug?: string
          source_url?: string
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_updates_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_updates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_updates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          logo_path: string | null
          name: string
          next_event_at: string | null
          next_event_label: string | null
          official_website: string | null
          organization_id: string | null
          search_vector: unknown
          short_name: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name: string
          next_event_at?: string | null
          next_event_label?: string | null
          official_website?: string | null
          organization_id?: string | null
          search_vector?: unknown
          short_name?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name?: string
          next_event_at?: string | null
          next_event_label?: string | null
          official_website?: string | null
          organization_id?: string | null
          search_vector?: unknown
          short_name?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_details: {
        Row: {
          application_fees: Json | null
          apply_link: string | null
          description: string | null
          eligibility_profile: Json | null
          eligibility_text: string | null
          experience_text: string | null
          important_dates: Json | null
          job_id: string
          notification_pdf: string | null
          official_website: string | null
          overview: Json | null
          raw: Json | null
          selection_process: Json | null
          updated_at: string
          vacancies_detail: Json | null
        }
        Insert: {
          application_fees?: Json | null
          apply_link?: string | null
          description?: string | null
          eligibility_profile?: Json | null
          eligibility_text?: string | null
          experience_text?: string | null
          important_dates?: Json | null
          job_id: string
          notification_pdf?: string | null
          official_website?: string | null
          overview?: Json | null
          raw?: Json | null
          selection_process?: Json | null
          updated_at?: string
          vacancies_detail?: Json | null
        }
        Update: {
          application_fees?: Json | null
          apply_link?: string | null
          description?: string | null
          eligibility_profile?: Json | null
          eligibility_text?: string | null
          experience_text?: string | null
          important_dates?: Json | null
          job_id?: string
          notification_pdf?: string | null
          official_website?: string | null
          overview?: Json | null
          raw?: Json | null
          selection_process?: Json | null
          updated_at?: string
          vacancies_detail?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "job_details_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          age_max: number | null
          age_min: number | null
          application_fee: number | null
          application_start_date: string | null
          created_at: string
          dedupe_key: string | null
          embedding: string | null
          experience_years_min: number | null
          gender: Database["public"]["Enums"]["gender_eligibility"]
          id: string
          is_featured: boolean
          last_date: string | null
          last_date_display: string | null
          location: string | null
          min_qualification_level:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          organization_id: string | null
          published_at: string | null
          qualification_summary: string | null
          required_skills: string[]
          required_stream:
            | Database["public"]["Enums"]["qualification_stream"]
            | null
          salary_display: string | null
          salary_max: number | null
          salary_min: number | null
          search_vector: unknown
          slug: string
          source_url: string | null
          state: string | null
          status: Database["public"]["Enums"]["job_status"]
          tags: string[]
          title: string
          updated_at: string
          vacancies: number | null
          vacancies_display: string | null
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          application_fee?: number | null
          application_start_date?: string | null
          created_at?: string
          dedupe_key?: string | null
          embedding?: string | null
          experience_years_min?: number | null
          gender?: Database["public"]["Enums"]["gender_eligibility"]
          id?: string
          is_featured?: boolean
          last_date?: string | null
          last_date_display?: string | null
          location?: string | null
          min_qualification_level?:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          organization_id?: string | null
          published_at?: string | null
          qualification_summary?: string | null
          required_skills?: string[]
          required_stream?:
            | Database["public"]["Enums"]["qualification_stream"]
            | null
          salary_display?: string | null
          salary_max?: number | null
          salary_min?: number | null
          search_vector?: unknown
          slug: string
          source_url?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tags?: string[]
          title: string
          updated_at?: string
          vacancies?: number | null
          vacancies_display?: string | null
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          application_fee?: number | null
          application_start_date?: string | null
          created_at?: string
          dedupe_key?: string | null
          embedding?: string | null
          experience_years_min?: number | null
          gender?: Database["public"]["Enums"]["gender_eligibility"]
          id?: string
          is_featured?: boolean
          last_date?: string | null
          last_date_display?: string | null
          location?: string | null
          min_qualification_level?:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          organization_id?: string | null
          published_at?: string | null
          qualification_summary?: string | null
          required_skills?: string[]
          required_stream?:
            | Database["public"]["Enums"]["qualification_stream"]
            | null
          salary_display?: string | null
          salary_max?: number | null
          salary_min?: number | null
          search_vector?: unknown
          slug?: string
          source_url?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tags?: string[]
          title?: string
          updated_at?: string
          vacancies?: number | null
          vacancies_display?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          deadline_reminders: boolean
          email_enabled: boolean
          exam_updates: boolean
          new_job_matches: boolean
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          telegram_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          deadline_reminders?: boolean
          email_enabled?: boolean
          exam_updates?: boolean
          new_job_matches?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          telegram_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          deadline_reminders?: boolean
          email_enabled?: boolean
          exam_updates?: boolean
          new_job_matches?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          telegram_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          aliases: string[]
          created_at: string
          id: string
          is_active: boolean
          logo_path: string | null
          name: string
          short_name: string | null
          slug: string
          updated_at: string
          website: string | null
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name: string
          short_name?: string | null
          slug: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          aliases?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name?: string
          short_name?: string | null
          slug?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          category: Database["public"]["Enums"]["reservation_category"] | null
          created_at: string
          date_of_birth: string | null
          district: string | null
          embedding: string | null
          experience_years: number | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender_eligibility"] | null
          highest_qualification:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          id: string
          onboarding_completed: boolean
          phone: string | null
          preferred_sectors: string[]
          preferred_states: string[]
          state: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          category?: Database["public"]["Enums"]["reservation_category"] | null
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          embedding?: string | null
          experience_years?: number | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_eligibility"] | null
          highest_qualification?:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          id: string
          onboarding_completed?: boolean
          phone?: string | null
          preferred_sectors?: string[]
          preferred_states?: string[]
          state?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          category?: Database["public"]["Enums"]["reservation_category"] | null
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          embedding?: string | null
          experience_years?: number | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_eligibility"] | null
          highest_qualification?:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          id?: string
          onboarding_completed?: boolean
          phone?: string | null
          preferred_sectors?: string[]
          preferred_states?: string[]
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      saved_exam_updates: {
        Row: {
          exam_update_id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          exam_update_id: string
          saved_at?: string
          user_id: string
        }
        Update: {
          exam_update_id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_exam_updates_exam_update_id_fkey"
            columns: ["exam_update_id"]
            isOneToOne: false
            referencedRelation: "exam_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_jobs: {
        Row: {
          job_id: string
          note: string | null
          saved_at: string
          user_id: string
        }
        Insert: {
          job_id: string
          note?: string | null
          saved_at?: string
          user_id: string
        }
        Update: {
          job_id?: string
          note?: string | null
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scraper_sources: {
        Row: {
          category: Database["public"]["Enums"]["update_category"]
          created_at: string
          id: string
          is_active: boolean
          last_scraped_at: string | null
          limit_per_run: number
          name: string
          updated_at: string
          url: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["update_category"]
          created_at?: string
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          limit_per_run?: number
          name: string
          updated_at?: string
          url: string
        }
        Update: {
          category?: Database["public"]["Enums"]["update_category"]
          created_at?: string
          id?: string
          is_active?: boolean
          last_scraped_at?: string | null
          limit_per_run?: number
          name?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      suggestions_grievances: {
        Row: {
          created_at: string
          email: string | null
          id: string
          message: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      sync_dead_letter: {
        Row: {
          attempts: number
          created_at: string
          error: string
          id: string
          kind: string
          payload: Json
          resolved_at: string | null
          source_key: string | null
          sync_run_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error: string
          id?: string
          kind: string
          payload: Json
          resolved_at?: string | null
          source_key?: string | null
          sync_run_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string
          id?: string
          kind?: string
          payload?: Json
          resolved_at?: string | null
          source_key?: string | null
          sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_dead_letter_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          rows_failed: number
          rows_inserted: number
          rows_seen: number
          rows_unchanged: number
          rows_updated: number
          started_at: string
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          rows_failed?: number
          rows_inserted?: number
          rows_seen?: number
          rows_unchanged?: number
          rows_updated?: number
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          rows_failed?: number
          rows_inserted?: number
          rows_seen?: number
          rows_unchanged?: number
          rows_updated?: number
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: []
      }
      telegram_connections: {
        Row: {
          is_active: boolean
          linked_at: string
          telegram_id: number
          user_id: string
          username: string | null
        }
        Insert: {
          is_active?: boolean
          linked_at?: string
          telegram_id: number
          user_id: string
          username?: string | null
        }
        Update: {
          is_active?: boolean
          linked_at?: string
          telegram_id?: number
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      user_calendar_events: {
        Row: {
          all_day: boolean
          created_at: string
          ends_at: string | null
          exam_id: string | null
          id: string
          job_id: string | null
          notes: string | null
          starts_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          created_at?: string
          ends_at?: string | null
          exam_id?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          starts_at: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          created_at?: string
          ends_at?: string | null
          exam_id?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_calendar_events_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_calendar_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          role: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: { Args: { check_role: string }; Returns: boolean }
      match_jobs: {
        Args: { p_limit?: number }
        Returns: {
          application_fee: number
          id: string
          is_featured: boolean
          last_date: string
          last_date_display: string
          location: string
          organization: Json
          published_at: string
          reasons: string[]
          salary_display: string
          salary_max: number
          salary_min: number
          slug: string
          state: string
          tags: string[]
          title: string
          vacancies: number
          vacancies_display: string
        }[]
      }
      prune_operational_data: {
        Args: never
        Returns: {
          rows_deleted: number
          table_name: string
        }[]
      }
      slugify: { Args: { input: string }; Returns: string }
      stream_of: {
        Args: { subject: string }
        Returns: Database["public"]["Enums"]["qualification_stream"]
      }
      text_array_to_string: {
        Args: { arr: string[]; sep: string }
        Returns: string
      }
    }
    Enums: {
      gender_eligibility: "any" | "male" | "female"
      job_link_state: "unresolved" | "linked" | "no_match" | "ambiguous"
      job_status: "draft" | "published" | "closed" | "archived"
      qualification_level:
        | "class_10"
        | "class_12"
        | "iti"
        | "diploma"
        | "bachelor"
        | "master"
        | "doctorate"
      qualification_stream:
        | "any"
        | "engineering"
        | "medical"
        | "nursing"
        | "pharmacy"
        | "teaching"
        | "law"
        | "commerce"
        | "computer"
        | "agriculture"
      reservation_category:
        | "general"
        | "ews"
        | "obc"
        | "obc_ncl"
        | "sc"
        | "st"
        | "pwd"
      sync_status: "running" | "succeeded" | "failed" | "partial"
      update_category:
        | "admit_card"
        | "result"
        | "answer_key"
        | "syllabus"
        | "notification"
        | "exam_date"
        | "cutoff"
        | "news"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      gender_eligibility: ["any", "male", "female"],
      job_link_state: ["unresolved", "linked", "no_match", "ambiguous"],
      job_status: ["draft", "published", "closed", "archived"],
      qualification_level: [
        "class_10",
        "class_12",
        "iti",
        "diploma",
        "bachelor",
        "master",
        "doctorate",
      ],
      qualification_stream: [
        "any",
        "engineering",
        "medical",
        "nursing",
        "pharmacy",
        "teaching",
        "law",
        "commerce",
        "computer",
        "agriculture",
      ],
      reservation_category: [
        "general",
        "ews",
        "obc",
        "obc_ncl",
        "sc",
        "st",
        "pwd",
      ],
      sync_status: ["running", "succeeded", "failed", "partial"],
      update_category: [
        "admit_card",
        "result",
        "answer_key",
        "syllabus",
        "notification",
        "exam_date",
        "cutoff",
        "news",
      ],
    },
  },
} as const

