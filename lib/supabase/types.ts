/**
 * Supabase 資料庫型別。
 *
 * Phase 1 僅涵蓋 profiles，後續 migration 新增資料表時同步擴充。
 * 亦可用 `supabase gen types typescript --linked` 重新產生。
 */

export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProfileRow = {
  id: string;
  owner_id: string;
  display_name: string | null;
  locale: string;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id?: string;
  owner_id: string;
  display_name?: string | null;
  locale?: string;
  created_at?: string;
  updated_at?: string;
};

export type ProfileUpdate = Partial<ProfileInsert>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
