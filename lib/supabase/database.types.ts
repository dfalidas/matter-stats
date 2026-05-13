export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      articles: {
        Row: {
          id: string;
          matter_id: string;
          title: string;
          url: string;
          source: string | null;
          author: string | null;
          word_count: number | null;
          reading_time_minutes: number | null;
          status: string;
          read_at: string | null;
          created_at: string;
          tags: string[] | null;
        };
        Insert: Omit<Database["public"]["Tables"]["articles"]["Row"], "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["articles"]["Insert"]>;
      };
      reading_sessions: {
        Row: {
          id: string;
          article_id: string;
          started_at: string;
          ended_at: string;
          duration_minutes: number;
          words_read: number;
        };
        Insert: Omit<Database["public"]["Tables"]["reading_sessions"]["Row"], "id"> & { id?: string };
        Update: Partial<Database["public"]["Tables"]["reading_sessions"]["Insert"]>;
      };
      highlights: {
        Row: {
          id: string;
          article_id: string;
          text: string;
          note: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["highlights"]["Row"], "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["highlights"]["Insert"]>;
      };
      sync_state: {
        Row: {
          id: string;
          provider: string;
          cursor: string | null;
          last_synced_at: string | null;
          metadata: Json | null;
        };
        Insert: Database["public"]["Tables"]["sync_state"]["Row"];
        Update: Partial<Database["public"]["Tables"]["sync_state"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
