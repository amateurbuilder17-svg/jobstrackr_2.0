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
      ai_usage: {
        Row: {
          day: string
          kind: string
          last_at: string
          used: number
          user_id: string
        }
        Insert: {
          day: string
          kind: string
          last_at?: string
          used?: number
          user_id: string
        }
        Update: {
          day?: string
          kind?: string
          last_at?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      api_keys_config: {
        Row: {
          api_key: string
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          last_error: string | null
          last_used_at: string | null
          model_name: string
          priority: number
          provider: string
          total_calls: number
          total_errors: number
          updated_at: string
        }
        Insert: {
          api_key: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_error?: string | null
          last_used_at?: string | null
          model_name?: string
          priority?: number
          provider?: string
          total_calls?: number
          total_errors?: number
          updated_at?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_error?: string | null
          last_used_at?: string | null
          model_name?: string
          priority?: number
          provider?: string
          total_calls?: number
          total_errors?: number
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          id: string
          kind: string
          label: string | null
          mime_type: string | null
          ocr_attempts: number
          ocr_error: string | null
          ocr_result: Json | null
          ocr_status: string
          reviewed_at: string | null
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
          ocr_attempts?: number
          ocr_error?: string | null
          ocr_result?: Json | null
          ocr_status?: string
          reviewed_at?: string | null
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
          ocr_attempts?: number
          ocr_error?: string | null
          ocr_result?: Json | null
          ocr_status?: string
          reviewed_at?: string | null
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
          job_id: string | null
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
          job_id?: string | null
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
          job_id?: string | null
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
          {
            foreignKeyName: "exam_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_status_reports: {
        Row: {
          confidence: number | null
          created_at: string
          exam_id: string | null
          grounded: boolean
          job_id: string | null
          model: string
          refresh_count: number
          refreshed_at: string
          report: Json
          sources: Json
          subject_key: string
          subject_label: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          exam_id?: string | null
          grounded?: boolean
          job_id?: string | null
          model: string
          refresh_count?: number
          refreshed_at?: string
          report: Json
          sources?: Json
          subject_key: string
          subject_label: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          exam_id?: string | null
          grounded?: boolean
          job_id?: string | null
          model?: string
          refresh_count?: number
          refreshed_at?: string
          report?: Json
          sources?: Json
          subject_key?: string
          subject_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_status_reports_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_status_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
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
          content_hash: string | null
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
          content_hash?: string | null
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
          content_hash?: string | null
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
      job_changes: {
        Row: {
          changed_at: string
          field: string
          id: number
          job_id: string
          new_value: string | null
          old_value: string | null
          sync_run_id: string | null
        }
        Insert: {
          changed_at?: string
          field: string
          id?: never
          job_id: string
          new_value?: string | null
          old_value?: string | null
          sync_run_id?: string | null
        }
        Update: {
          changed_at?: string
          field?: string
          id?: never
          job_id?: string
          new_value?: string | null
          old_value?: string | null
          sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_changes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_changes_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_details: {
        Row: {
          age_limit_text: string | null
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
          salary_text: string | null
          selection_process: Json | null
          updated_at: string
          vacancies_detail: Json | null
        }
        Insert: {
          age_limit_text?: string | null
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
          salary_text?: string | null
          selection_process?: Json | null
          updated_at?: string
          vacancies_detail?: Json | null
        }
        Update: {
          age_limit_text?: string | null
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
          salary_text?: string | null
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
          content_hash: string | null
          created_at: string
          dedupe_key: string | null
          embedding: string | null
          experience_years_min: number | null
          gender: Database["public"]["Enums"]["gender_eligibility"]
          grade: string | null
          id: string
          is_featured: boolean
          last_date: string | null
          last_date_display: string | null
          location: string | null
          location_state: string | null
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
          skill_tags: string[] | null
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
          content_hash?: string | null
          created_at?: string
          dedupe_key?: string | null
          embedding?: string | null
          experience_years_min?: number | null
          gender?: Database["public"]["Enums"]["gender_eligibility"]
          grade?: string | null
          id?: string
          is_featured?: boolean
          last_date?: string | null
          last_date_display?: string | null
          location?: string | null
          location_state?: string | null
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
          skill_tags?: string[] | null
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
          content_hash?: string | null
          created_at?: string
          dedupe_key?: string | null
          embedding?: string | null
          experience_years_min?: number | null
          gender?: Database["public"]["Enums"]["gender_eligibility"]
          grade?: string | null
          id?: string
          is_featured?: boolean
          last_date?: string | null
          last_date_display?: string | null
          location?: string | null
          location_state?: string | null
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
          skill_tags?: string[] | null
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
          aadhaar_number: string | null
          aadhaar_number_encrypted: string | null
          address: string | null
          avatar_path: string | null
          caste_certificate_number: string | null
          caste_issue_date: string | null
          caste_issuing_authority: string | null
          caste_name: string | null
          category: Database["public"]["Enums"]["reservation_category"] | null
          created_at: string
          current_status: string | null
          date_of_birth: string | null
          disability_certificate_number: string | null
          disability_type: string | null
          district: string | null
          embedding: string | null
          ews_certificate_number: string | null
          ews_issuing_authority: string | null
          experience_years: number | null
          father_name: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender_eligibility"] | null
          highest_qualification:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          id: string
          marital_status: string | null
          mother_name: string | null
          onboarding_completed: boolean
          pan_number: string | null
          pan_number_encrypted: string | null
          passport_number: string | null
          passport_number_encrypted: string | null
          phone: string | null
          pincode: string | null
          preferred_grades: string[]
          preferred_salary_max: number | null
          preferred_salary_min: number | null
          preferred_sectors: string[]
          preferred_states: string[]
          skills: string[]
          state: string | null
          sub_category: string | null
          updated_at: string
        }
        Insert: {
          aadhaar_number?: string | null
          aadhaar_number_encrypted?: string | null
          address?: string | null
          avatar_path?: string | null
          caste_certificate_number?: string | null
          caste_issue_date?: string | null
          caste_issuing_authority?: string | null
          caste_name?: string | null
          category?: Database["public"]["Enums"]["reservation_category"] | null
          created_at?: string
          current_status?: string | null
          date_of_birth?: string | null
          disability_certificate_number?: string | null
          disability_type?: string | null
          district?: string | null
          embedding?: string | null
          ews_certificate_number?: string | null
          ews_issuing_authority?: string | null
          experience_years?: number | null
          father_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_eligibility"] | null
          highest_qualification?:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          id: string
          marital_status?: string | null
          mother_name?: string | null
          onboarding_completed?: boolean
          pan_number?: string | null
          pan_number_encrypted?: string | null
          passport_number?: string | null
          passport_number_encrypted?: string | null
          phone?: string | null
          pincode?: string | null
          preferred_grades?: string[]
          preferred_salary_max?: number | null
          preferred_salary_min?: number | null
          preferred_sectors?: string[]
          preferred_states?: string[]
          skills?: string[]
          state?: string | null
          sub_category?: string | null
          updated_at?: string
        }
        Update: {
          aadhaar_number?: string | null
          aadhaar_number_encrypted?: string | null
          address?: string | null
          avatar_path?: string | null
          caste_certificate_number?: string | null
          caste_issue_date?: string | null
          caste_issuing_authority?: string | null
          caste_name?: string | null
          category?: Database["public"]["Enums"]["reservation_category"] | null
          created_at?: string
          current_status?: string | null
          date_of_birth?: string | null
          disability_certificate_number?: string | null
          disability_type?: string | null
          district?: string | null
          embedding?: string | null
          ews_certificate_number?: string | null
          ews_issuing_authority?: string | null
          experience_years?: number | null
          father_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_eligibility"] | null
          highest_qualification?:
            | Database["public"]["Enums"]["qualification_level"]
            | null
          id?: string
          marital_status?: string | null
          mother_name?: string | null
          onboarding_completed?: boolean
          pan_number?: string | null
          pan_number_encrypted?: string | null
          passport_number?: string | null
          passport_number_encrypted?: string | null
          phone?: string | null
          pincode?: string | null
          preferred_grades?: string[]
          preferred_salary_max?: number | null
          preferred_salary_min?: number | null
          preferred_sectors?: string[]
          preferred_states?: string[]
          skills?: string[]
          state?: string | null
          sub_category?: string | null
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
          kind: string
          message: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          message: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          message?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      syllabus_cache: {
        Row: {
          confidence: number | null
          data: Json
          exam_key: string
          exam_name: string
          expires_at: string
          fetched_at: string
          grounded: boolean
          model: string | null
          slug: string
          sources: string[]
          year: number | null
        }
        Insert: {
          confidence?: number | null
          data: Json
          exam_key: string
          exam_name: string
          expires_at?: string
          fetched_at?: string
          grounded?: boolean
          model?: string | null
          slug: string
          sources?: string[]
          year?: number | null
        }
        Update: {
          confidence?: number | null
          data?: Json
          exam_key?: string
          exam_name?: string
          expires_at?: string
          fetched_at?: string
          grounded?: boolean
          model?: string | null
          slug?: string
          sources?: string[]
          year?: number | null
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
      decrypted_api_keys_config: {
        Row: {
          api_key: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          label: string | null
          last_error: string | null
          last_used_at: string | null
          model_name: string | null
          priority: number | null
          provider: string | null
          total_calls: number | null
          total_errors: number | null
          updated_at: string | null
        }
        Insert: {
          api_key?: never
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          label?: string | null
          last_error?: string | null
          last_used_at?: string | null
          model_name?: string | null
          priority?: number | null
          provider?: string | null
          total_calls?: number | null
          total_errors?: number | null
          updated_at?: string | null
        }
        Update: {
          api_key?: never
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          label?: string | null
          last_error?: string | null
          last_used_at?: string | null
          model_name?: string | null
          priority?: number | null
          provider?: string | null
          total_calls?: number | null
          total_errors?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_table_stats: {
        Args: never
        Returns: {
          bytes_per_row: number
          row_estimate: number
          table_name: string
          total_bytes: number
        }[]
      }
      blocker_skill_tags: { Args: never; Returns: string[] }
      claim_ai_quota: {
        Args: {
          p_cooldown_seconds: number
          p_daily_limit: number
          p_kind: string
        }
        Returns: {
          allowed: boolean
          resets_at: string
          retry_after: number
          used: number
        }[]
      }
      close_expired_jobs: { Args: never; Returns: number }
      decrypt_api_key: { Args: { encrypted_key: string }; Returns: string }
      decrypt_own_id: { Args: { p_field: string }; Returns: string }
      grade_of: { Args: { subject: string }; Returns: string }
      has_role: { Args: { check_role: string }; Returns: boolean }
      level_of: {
        Args: { subject: string }
        Returns: Database["public"]["Enums"]["qualification_level"]
      }
      match_feed: {
        Args: { p_limit?: number }
        Returns: {
          application_fee: number
          gaps: string[]
          id: string
          is_featured: boolean
          last_date: string
          last_date_display: string
          location: string
          organization: Json
          published_at: string
          qualification_summary: string
          reasons: string[]
          salary_display: string
          salary_max: number
          salary_min: number
          slug: string
          state: string
          tags: string[]
          tier: string
          tier_total: number
          title: string
          vacancies: number
          vacancies_display: string
        }[]
      }
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
      match_jobs_blocked: {
        Args: { p_limit?: number }
        Returns: {
          application_fee: number
          blocker: string
          blocker_value: string
          id: string
          is_featured: boolean
          last_date: string
          last_date_display: string
          location: string
          organization: Json
          published_at: string
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
      popular_exams: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          logo_path: string
          name: string
          next_event_at: string
          next_event_label: string
          short_name: string
          slug: string
          tracked: number
        }[]
      }
      prune_operational_data: {
        Args: never
        Returns: {
          rows_deleted: number
          table_name: string
        }[]
      }
      resolve_update_job_links: {
        Args: { p_batch?: number }
        Returns: {
          ambiguous: number
          linked: number
          no_match: number
        }[]
      }
      skill_tags_of: { Args: { subject: string }; Returns: string[] }
      slugify: { Args: { input: string }; Returns: string }
      stale_status_subjects: {
        Args: { p_limit?: number; p_stale_after?: unknown }
        Returns: {
          exam_id: string
          job_id: string
          official_website: string
          organization: string
          refreshed_at: string
          subject_key: string
          subject_label: string
          trackers: number
        }[]
      }
      state_of: { Args: { p_location: string }; Returns: string }
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

