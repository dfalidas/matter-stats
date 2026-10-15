export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      app_sessions: {
        Row: { token_hash: string; credential_version: number; created_at: string; expires_at: string; revoked_at: string | null; last_seen_at: string | null };
        Insert: { token_hash: string; credential_version: number; created_at?: string; expires_at: string; revoked_at?: string | null; last_seen_at?: string | null };
        Update: { token_hash?: string; credential_version?: number; created_at?: string; expires_at?: string; revoked_at?: string | null; last_seen_at?: string | null };
        Relationships: [];
      };
      app_login_attempts: {
        Row: { client_key_hash: string; attempted_at: string; succeeded: boolean };
        Insert: { client_key_hash: string; attempted_at?: string; succeeded?: boolean };
        Update: { client_key_hash?: string; attempted_at?: string; succeeded?: boolean };
        Relationships: [];
      };
      matter_items: {
        Row: {
          id: string;
          title: string | null;
          url: string | null;
          source: string | null;
          author: string | null;
          content_type: string | null;
          status: string | null;
          word_count: number | null;
          estimated_reading_time_minutes: number | null;
          progress: number | null;
          created_at_matter: string | null;
          updated_at_matter: string | null;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          title?: string | null;
          url?: string | null;
          source?: string | null;
          author?: string | null;
          content_type?: string | null;
          status?: string | null;
          word_count?: number | null;
          estimated_reading_time_minutes?: number | null;
          progress?: number | null;
          created_at_matter?: string | null;
          updated_at_matter?: string | null;
          last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string | null;
          url?: string | null;
          source?: string | null;
          author?: string | null;
          content_type?: string | null;
          status?: string | null;
          word_count?: number | null;
          estimated_reading_time_minutes?: number | null;
          progress?: number | null;
          created_at_matter?: string | null;
          updated_at_matter?: string | null;
          last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reading_sessions: {
        Row: {
          id: string;
          item_id: string | null;
          started_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          source_device: string | null;
          words_estimated: number | null;
          word_estimation_method?: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          item_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          source_device?: string | null;
          words_estimated?: number | null;
          word_estimation_method?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          source_device?: string | null;
          words_estimated?: number | null;
          word_estimation_method?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reading_sessions_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "matter_items";
            referencedColumns: ["id"];
          },
        ];
      };
      matter_tags: {
        Row: {
          id: string;
          name: string;
          created_at_matter: string | null;
          updated_at_matter: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          created_at_matter?: string | null;
          updated_at_matter?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at_matter?: string | null;
          updated_at_matter?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      item_tags: {
        Row: {
          item_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          item_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: {
          item_id?: string;
          tag_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_tags_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "matter_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "matter_tags";
            referencedColumns: ["id"];
          },
        ];
      };
      annotations: {
        Row: {
          id: string;
          item_id: string;
          text: string | null;
          note: string | null;
          created_at_matter: string | null;
          updated_at_matter: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          item_id: string;
          text?: string | null;
          note?: string | null;
          created_at_matter?: string | null;
          updated_at_matter?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          text?: string | null;
          note?: string | null;
          created_at_matter?: string | null;
          updated_at_matter?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "annotations_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "matter_items";
            referencedColumns: ["id"];
          },
        ];
      };
      reading_generation_control: {
        Row: { singleton: boolean; active: string | null; previous: string | null; building: string | null; frozen: string | null; epoch: number; source_revision: number };
        Insert: never; Update: never; Relationships: [];
      };
      daily_stats: {
        Row: {
          date: string;
          reading_time_seconds: number;
          words_read: number;
          sessions_count: number;
          items_read_count: number;
          highlights_count: number;
          top_source: string | null;
          reading_provenance?: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          date: string;
          reading_time_seconds?: number;
          words_read?: number;
          sessions_count?: number;
          items_read_count?: number;
          highlights_count?: number;
          top_source?: string | null;
          reading_provenance?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          date?: string;
          reading_time_seconds?: number;
          words_read?: number;
          sessions_count?: number;
          items_read_count?: number;
          highlights_count?: number;
          top_source?: string | null;
          reading_provenance?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sync_state: {
        Row: {
          id: string;
          completed_checkpoint_timestamp: string | null;
          active_since_timestamp: string | null;
          active_phase: string;
          item_cursor: string | null;
          tag_cursor: string | null;
          session_cursor: string | null;
          next_checkpoint_timestamp: string | null;
          rate_limited_until: string | null;
          sync_mode: string;
          recent_activity_checkpoint: string | null;
          backfill_items_cursor: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          completed_checkpoint_timestamp?: string | null;
          active_since_timestamp?: string | null;
          active_phase?: string;
          item_cursor?: string | null;
          tag_cursor?: string | null;
          session_cursor?: string | null;
          next_checkpoint_timestamp?: string | null;
          rate_limited_until?: string | null;
          sync_mode?: string;
          recent_activity_checkpoint?: string | null;
          backfill_items_cursor?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          completed_checkpoint_timestamp?: string | null;
          active_since_timestamp?: string | null;
          active_phase?: string;
          item_cursor?: string | null;
          tag_cursor?: string | null;
          session_cursor?: string | null;
          next_checkpoint_timestamp?: string | null;
          rate_limited_until?: string | null;
          sync_mode?: string;
          recent_activity_checkpoint?: string | null;
          backfill_items_cursor?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      matter_sync_continuation: {
        Row: MatterContinuation;
        Insert: Partial<MatterContinuation> & { account_scope: string };
        Update: Partial<MatterContinuation>;
        Relationships: [];
      };
      matter_page_receipts: {
        Row: { stream: string; receipt_id: string; fingerprint: string };
        Insert: { stream: string; receipt_id: string; fingerprint: string };
        Update: { receipt_id?: string; fingerprint?: string };
        Relationships: [];
      };
      matter_dirty_rollups: {
        Row: { date: string; revision: string; timezone: string };
        Insert: { date: string; revision: string; timezone: string };
        Update: { revision?: string; timezone?: string };
        Relationships: [];
      };
      matter_sync_leases: {
        Row: { account_scope: string; owner: string | null; expires_at: string | null; generation: number };
        Insert: { account_scope: string; owner?: string | null; expires_at?: string | null; generation?: number };
        Update: { owner?: string | null; expires_at?: string | null; generation?: number };
        Relationships: [];
      };
      matter_sync_streams: {
        Row: {
          stream: string;
          endpoint: string;
          filters: Json;
          page_limit: number;
          cursor: string | null;
          cycle_started_at: string | null;
          cycle_generation: number;
          completed_watermark: string | null;
          retry_at: string | null;
          cycle_active: boolean;
          transition_status: string;
          coverage_window: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          stream: string;
          endpoint: string;
          filters?: Json;
          page_limit: number;
          cursor?: string | null;
          cycle_started_at?: string | null;
          cycle_generation?: number;
          completed_watermark?: string | null;
          retry_at?: string | null;
          cycle_active?: boolean;
          transition_status?: string;
          coverage_window?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["matter_sync_streams"]["Insert"]>;
        Relationships: [];
      };
      matter_cycle_completions: {
        Row: { stream: string; cycle_generation: number; source_boundary: string; completed_at: string };
        Insert: { stream: string; cycle_generation: number; source_boundary: string; completed_at: string };
        Update: Partial<Database["public"]["Tables"]["matter_cycle_completions"]["Insert"]>;
        Relationships: [];
      };
      matter_invocation_status: {
        Row: { trigger: string; id: string; attempted_at: string; outcome: string; finished_at: string | null };
        Insert: { trigger: string; id: string; attempted_at: string; outcome: string; finished_at?: string | null };
        Update: Partial<Database["public"]["Tables"]["matter_invocation_status"]["Insert"]>;
        Relationships: [];
      };
      sync_runs: {
        Row: {
          id: string;
          started_at: string;
          finished_at: string | null;
          status: string;
          items_synced: number;
          sessions_synced: number;
          annotations_synced: number;
          tags_synced: number;
          sync_mode: string;
          matter_requests_count: number;
          matter_sessions_returned: number;
          matter_items_returned: number;
          matter_sessions_skipped: number;
          matter_sessions_without_linked_item: number;
          matter_first_session_shape: Json | null;
          matter_has_more: boolean | null;
          matter_next_cursor_present: boolean | null;
          error_message: string | null;
          checkpoint_timestamp: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          started_at?: string;
          finished_at?: string | null;
          status: string;
          items_synced?: number;
          sessions_synced?: number;
          annotations_synced?: number;
          tags_synced?: number;
          sync_mode?: string;
          matter_requests_count?: number;
          matter_sessions_returned?: number;
          matter_items_returned?: number;
          matter_sessions_skipped?: number;
          matter_sessions_without_linked_item?: number;
          matter_first_session_shape?: Json | null;
          matter_has_more?: boolean | null;
          matter_next_cursor_present?: boolean | null;
          error_message?: string | null;
          checkpoint_timestamp?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          started_at?: string;
          finished_at?: string | null;
          status?: string;
          items_synced?: number;
          sessions_synced?: number;
          annotations_synced?: number;
          tags_synced?: number;
          sync_mode?: string;
          matter_requests_count?: number;
          matter_sessions_returned?: number;
          matter_items_returned?: number;
          matter_sessions_skipped?: number;
          matter_sessions_without_linked_item?: number;
          matter_first_session_shape?: Json | null;
          matter_has_more?: boolean | null;
          matter_next_cursor_present?: boolean | null;
          error_message?: string | null;
          checkpoint_timestamp?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      record_matter_invocation: { Args: { p_id: string; p_trigger: string; p_outcome: string }; Returns: undefined };
      read_matter_generation_status: { Args: Record<string, never>; Returns: Json };
      read_matter_retry_status: { Args: { p_now: string }; Returns: Json };

      prepare_matter_request_work: { Args: LeaseRpcArgs & { p_expected: Json }; Returns: undefined };
      admit_matter_request: { Args: { p_slot: string; p_key: string; p_markdown: boolean; p_recover: boolean; p_lease: Json | null }; Returns: Json };
      finish_matter_request: { Args: { p_slot: string; p_key: string; p_sequence: string; p_entry: Json; p_lease: Json | null }; Returns: undefined };
      feedback_matter_request: { Args: { p_sequence: string; p_limit: number | null; p_remaining: number | null; p_reset: string | null; p_cooldown: string | null }; Returns: undefined };
      cooldown_matter_account: { Args: LeaseRpcArgs & { p_retry_at: string }; Returns: undefined };
      request_matter_history: { Args: LeaseRpcArgs & { p_coverage: string }; Returns: MatterContinuation };
      begin_matter_history: { Args: LeaseRpcArgs & { p_limit: number; p_started_at: string }; Returns: MatterSyncStream };
      turn_matter_continuation: { Args: LeaseRpcArgs & { p_stream: string }; Returns: undefined };
      complete_matter_history: { Args: Record<string, never>; Returns: unknown };
      read_generation_days: { Args: { p_generation: string | null; p_after: string | null; p_since: string | null; p_limit: number }; Returns: Json[] };
      read_generation_estimates: { Args: { p_generation: string | null; p_ids: string[] }; Returns: Json[] };
      commit_matter_page: {
        Args: LeaseRpcArgs & { p_receipt_id: string; p_previous_receipt_id: string | null; p_expected: TablesInsert<"matter_sync_streams">; p_plan: import("./matter-page-plan").MatterPagePlan; p_has_more: boolean; p_next_cursor: string | null; p_timezone: string };
        Returns: MatterSyncStream;
      };
      validate_matter_page_rows: { Args: { p_rows: Json; p_kind: string }; Returns: undefined };
      pending_matter_rollups: { Args: LeaseRpcArgs & { p_limit: number }; Returns: DirtyMatterRollup[] };
      ack_matter_rollup: { Args: LeaseRpcArgs & { p_date: string; p_revision: string; p_timezone: string; p_row: TablesInsert<"daily_stats"> }; Returns: boolean };
      acquire_matter_sync_lease: {
        Args: { p_account_scope: string; p_owner: string; p_ttl_seconds: number };
        Returns: { generation: string; expires_at: string }[];
      };
      renew_matter_sync_lease: { Args: LeaseRpcArgs & { p_ttl_seconds: number }; Returns: boolean };
      release_matter_sync_lease: { Args: LeaseRpcArgs; Returns: boolean };
      assert_matter_sync_lease: { Args: LeaseRpcArgs; Returns: undefined };
      validate_matter_sync_batch: { Args: { p_rows: Json; p_max_rows: number }; Returns: undefined };
      sync_upsert_matter_items: { Args: LeaseRpcArgs & { p_rows: TablesInsert<"matter_items">[] }; Returns: MatterItem[] };
      sync_upsert_reading_sessions: { Args: LeaseRpcArgs & { p_rows: TablesInsert<"reading_sessions">[] }; Returns: ReadingSession[] };
      sync_upsert_matter_tags: { Args: LeaseRpcArgs & { p_rows: TablesInsert<"matter_tags">[] }; Returns: MatterTag[] };
      sync_upsert_annotations: { Args: LeaseRpcArgs & { p_rows: TablesInsert<"annotations">[] }; Returns: Annotation[] };
      sync_upsert_daily_stats: { Args: LeaseRpcArgs & { p_rows: TablesInsert<"daily_stats">[] }; Returns: DailyStat[] };
      sync_replace_item_tags: { Args: LeaseRpcArgs & { p_item_ids: string[]; p_rows: TablesInsert<"item_tags">[] }; Returns: undefined };
      sync_upsert_stream: { Args: LeaseRpcArgs & { p_state: TablesInsert<"matter_sync_streams"> }; Returns: MatterSyncStream };
      sync_create_run: { Args: LeaseRpcArgs & { p_started_at: string; p_sync_mode: string }; Returns: SyncRun };
      sync_update_run: { Args: LeaseRpcArgs & { p_id: string; p_patch: TablesUpdate<"sync_runs"> }; Returns: SyncRun };
      record_app_login_attempt: {
        Args: { p_client_key_hash: string; p_succeeded: boolean; p_limit?: number; p_window_seconds?: number };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];

export type MatterItem = Tables<"matter_items">;
export type ReadingSession = Tables<"reading_sessions">;
export type MatterTag = Tables<"matter_tags">;
export type ItemTag = Tables<"item_tags">;
export type Annotation = Tables<"annotations">;
export type DailyStat = Tables<"daily_stats">;
export type SyncState = Tables<"sync_state">;
export type MatterSyncStream = Tables<"matter_sync_streams">;
export type SyncRun = Tables<"sync_runs">;

export type LeaseRpcArgs = { p_account_scope: string; p_owner: string; p_generation: string };

export type DirtyMatterRollup = Tables<"matter_dirty_rollups">;

export type MatterContinuation = {
  account_scope: string; coverage: "all"; history_status: "none" | "pending" | "running" | "complete";
  requested_at: string | null; history_cycle_generation: number | null; completed_at: string | null;
  next_stream: "recent_sessions" | "library_items";
};
