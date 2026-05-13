export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
          item_id: string;
          started_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          source_device: string | null;
          words_estimated: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          item_id: string;
          started_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          source_device?: string | null;
          words_estimated?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          started_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          source_device?: string | null;
          words_estimated?: number | null;
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
      daily_stats: {
        Row: {
          date: string;
          reading_time_seconds: number;
          words_read: number;
          sessions_count: number;
          items_read_count: number;
          highlights_count: number;
          top_source: string | null;
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
          created_at?: string;
          updated_at?: string;
        };
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
          error_message?: string | null;
          checkpoint_timestamp?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
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
export type SyncRun = Tables<"sync_runs">;
