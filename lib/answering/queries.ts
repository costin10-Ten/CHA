import { createClient } from "@/lib/supabase/server";
import type {
  AnswerEvidenceRow,
  AnswerSentenceRow,
  AnswerSessionRow,
} from "@/lib/supabase/types";

export async function listAnswerSessions(limit = 20): Promise<AnswerSessionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("answer_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取問答紀錄失敗：${error.message}`);
  return data ?? [];
}

export async function getAnswerSession(
  id: string,
): Promise<AnswerSessionRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("answer_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`讀取問答失敗：${error.message}`);
  return data;
}

export async function listAnswerEvidence(
  sessionId: string,
): Promise<AnswerEvidenceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("answer_evidence")
    .select("*")
    .eq("answer_session_id", sessionId)
    .order("rank", { ascending: true });

  if (error) throw new Error(`讀取證據包失敗：${error.message}`);
  return data ?? [];
}

export async function listAnswerSentences(
  sessionId: string,
): Promise<AnswerSentenceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("answer_sentences")
    .select("*")
    .eq("answer_session_id", sessionId)
    .order("position", { ascending: true });

  if (error) throw new Error(`讀取拆句結果失敗：${error.message}`);
  return data ?? [];
}
