/**
 * Supabase 資料庫型別。
 *
 * 涵蓋 Phase 1（profiles）與 Phase 2（sources、source_versions、
 * document_chunks、processing_jobs）。新增 migration 時同步擴充，
 * 亦可用 `supabase gen types typescript --linked` 重新產生。
 */

export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SourceType = "text" | "file" | "url";
export type SourceStatus =
  "pending" | "processing" | "ready" | "failed" | "archived";
export type JobType =
  | "parse_document"
  | "extract_facts"
  | "generate_embeddings"
  | "verify_answer"
  | "generate_content"
  | "scheduled_update";
export type JobStatus =
  "pending" | "processing" | "completed" | "failed" | "retrying" | "cancelled";

export type KnowledgeType =
  "substance" | "concept" | "policy" | "event" | "topic" | "other";
export type RiskLevel = "low" | "medium" | "high";
export type CandidateStatus =
  "pending" | "approved" | "rejected" | "needs_fix" | "merged" | "split";

export type FactConditions = {
  population?: string | null;
  exposure_route?: string | null;
  dose?: string | null;
  duration?: string | null;
  location?: string | null;
  timeframe?: string | null;
};

export type ProfileRow = {
  id: string;
  owner_id: string;
  display_name: string | null;
  locale: string;
  created_at: string;
  updated_at: string;
};

export type SourceRow = {
  id: string;
  owner_id: string;
  title: string;
  source_type: SourceType;
  origin_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  current_version: number;
  content_hash: string | null;
  status: SourceStatus;
  last_error: string | null;
  fetched_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SourceVersionRow = {
  id: string;
  owner_id: string;
  source_id: string;
  version: number;
  title: string | null;
  raw_text: string | null;
  raw_html: string | null;
  storage_path: string | null;
  content_hash: string;
  parser_version: string;
  char_count: number;
  chunk_count: number;
  is_current: boolean;
  fetched_at: string;
  created_at: string;
  updated_at: string;
};

export type DocumentChunkRow = {
  id: string;
  owner_id: string;
  source_id: string;
  source_version_id: string;
  paragraph_id: string;
  position: number;
  block_type: string;
  heading_path: string[];
  text: string;
  char_start: number;
  char_end: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
};

export type ProcessingJobRow = {
  id: string;
  owner_id: string;
  job_type: JobType;
  status: JobStatus;
  source_id: string | null;
  payload: Json;
  result: Json | null;
  progress: number;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  model_usage: Json;
  created_at: string;
  updated_at: string;
};

export type PromptVersionRow = {
  id: string;
  owner_id: string;
  name: string;
  version: number;
  purpose: string;
  template: string;
  checksum: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ModelRunRow = {
  id: string;
  owner_id: string;
  job_id: string | null;
  source_id: string | null;
  prompt_version_id: string | null;
  purpose: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateFactRow = {
  id: string;
  owner_id: string;
  source_id: string;
  source_version_id: string;
  document_chunk_id: string | null;
  statement: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  knowledge_type: KnowledgeType;
  conditions: FactConditions;
  source_quote: string;
  source_paragraph_id: string;
  risk_level: RiskLevel;
  confidence: number;
  status: CandidateStatus;
  quality_flags: string[];
  quality_score: number;
  duplicate_of: string | null;
  contradicts: string[];
  statement_hash: string;
  prompt_version_id: string | null;
  model_run_id: string | null;
  extraction_batch: string | null;
  created_at: string;
  updated_at: string;
};

type Insertable<T, Required extends keyof T> = Partial<Omit<T, Required>> &
  Pick<T, Required>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Insertable<ProfileRow, "owner_id">;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      sources: {
        Row: SourceRow;
        Insert: Insertable<SourceRow, "owner_id" | "title" | "source_type">;
        Update: Partial<SourceRow>;
        Relationships: [];
      };
      source_versions: {
        Row: SourceVersionRow;
        Insert: Insertable<
          SourceVersionRow,
          "owner_id" | "source_id" | "version" | "content_hash" | "parser_version"
        >;
        Update: Partial<SourceVersionRow>;
        Relationships: [];
      };
      document_chunks: {
        Row: DocumentChunkRow;
        Insert: Insertable<
          DocumentChunkRow,
          | "owner_id"
          | "source_id"
          | "source_version_id"
          | "paragraph_id"
          | "position"
          | "text"
          | "content_hash"
        >;
        Update: Partial<DocumentChunkRow>;
        Relationships: [];
      };
      processing_jobs: {
        Row: ProcessingJobRow;
        Insert: Insertable<ProcessingJobRow, "owner_id" | "job_type">;
        Update: Partial<ProcessingJobRow>;
        Relationships: [];
      };
      prompt_versions: {
        Row: PromptVersionRow;
        Insert: Insertable<
          PromptVersionRow,
          "owner_id" | "name" | "purpose" | "template" | "checksum"
        >;
        Update: Partial<PromptVersionRow>;
        Relationships: [];
      };
      model_runs: {
        Row: ModelRunRow;
        Insert: Insertable<
          ModelRunRow,
          "owner_id" | "purpose" | "provider" | "model"
        >;
        Update: Partial<ModelRunRow>;
        Relationships: [];
      };
      candidate_facts: {
        Row: CandidateFactRow;
        Insert: Insertable<
          CandidateFactRow,
          | "owner_id"
          | "source_id"
          | "source_version_id"
          | "statement"
          | "source_quote"
          | "source_paragraph_id"
          | "statement_hash"
        >;
        Update: Partial<CandidateFactRow>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      claim_processing_jobs: {
        Args: {
          p_job_types: JobType[];
          p_limit?: number;
          p_worker?: string;
          p_owner?: string | null;
        };
        Returns: ProcessingJobRow[];
      };
      complete_processing_job: {
        Args: { p_job_id: string; p_result?: Json; p_usage?: Json };
        Returns: undefined;
      };
      fail_processing_job: {
        Args: { p_job_id: string; p_error: string };
        Returns: JobStatus;
      };
      update_job_progress: {
        Args: { p_job_id: string; p_progress: number };
        Returns: undefined;
      };
      upsert_prompt_version: {
        Args: {
          p_owner: string;
          p_name: string;
          p_purpose: string;
          p_template: string;
          p_checksum: string;
        };
        Returns: string;
      };
    };
    Enums: {
      source_type: SourceType;
      source_status: SourceStatus;
      job_type: JobType;
      job_status: JobStatus;
      knowledge_type: KnowledgeType;
      risk_level: RiskLevel;
      candidate_status: CandidateStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
