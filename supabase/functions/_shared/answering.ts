import { sha256Hex } from "./hash.ts";
import type { LlmMessage } from "./llm/types.ts";

/**
 * 證據包與 AI 問答（工作單第 13 節）。
 *
 * 核心規則：送進生成模型的只有核定原子命題，模型不得補充自己的知識。
 * 這裡負責組證據包、產生提示詞、解析引用，以及把回答拆句（供 Phase 7 驗證）。
 */

export const ANSWER_PROMPT_NAME = "answer-question";

export const ANSWER_SYSTEM_PROMPT = `你是風險溝通知識庫的回答助理。

你只能使用「證據包」中列出的核定原子命題回答問題。

必須遵守：
1. 只使用證據包中的原子命題，不得使用你自己的記憶或常識補充任何原子命題。
2. 每一段結尾都要標註使用的知識編號，格式為 [K-0001]，可標註多個。
3. 證據不足以回答時，明確說明「現有核定原子命題不足以回答這個問題」，並指出缺少哪方面的資訊，不要猜測。
4. 保留原子命題中的條件與限制：族群、劑量、暴露途徑、時間範圍不可省略。
5. 保留原有的不確定性語氣，不得把「可能」改寫成「一定」或「會」。
6. 不得改動數字、單位與年份。
7. 語氣平實，不要聳動、不要使用恐嚇性措辭。
8. 用繁體中文回答，直接給答案，不要重複問題或加開場白。`;

export interface EvidenceFact {
  knowledgeId: string;
  factId: string;
  statement: string;
  conditions: Record<string, string | null>;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceLocator: string | null;
  version: number;
}

export interface EvidencePack {
  question: string;
  facts: {
    knowledge_id: string;
    statement: string;
    conditions: Record<string, string | null>;
    source_title: string | null;
    source_url: string | null;
    source_locator: string | null;
    version: number;
  }[];
}

/** 知識編號：K-0001，供回答引用。 */
export function formatKnowledgeRef(index: number): string {
  return `K-${String(index + 1).padStart(4, "0")}`;
}

export function buildEvidencePack(
  question: string,
  facts: EvidenceFact[],
): EvidencePack {
  return {
    question,
    facts: facts.map((fact) => ({
      knowledge_id: fact.knowledgeId,
      statement: fact.statement,
      conditions: Object.fromEntries(
        Object.entries(fact.conditions ?? {}).filter(([, value]) => value),
      ) as Record<string, string | null>,
      source_title: fact.sourceTitle,
      source_url: fact.sourceUrl,
      source_locator: fact.sourceLocator,
      version: fact.version,
    })),
  };
}

export function buildAnswerMessages(pack: EvidencePack): LlmMessage[] {
  return [
    { role: "system", content: ANSWER_SYSTEM_PROMPT },
    {
      role: "user",
      content: `問題：${pack.question}\n\n證據包（只能使用這些原子命題）：\n${JSON.stringify(
        pack,
        null,
        2,
      )}`,
    },
  ];
}

export function answerPromptChecksum(): Promise<string> {
  return sha256Hex(ANSWER_SYSTEM_PROMPT);
}

/** 從回答中取出被引用的知識編號。 */
export function extractCitations(answer: string): string[] {
  const matches = answer.matchAll(/\[(K-\d{4})\]/g);
  return [...new Set([...matches].map((match) => match[1]))];
}

/** 回答是否明確表示證據不足。 */
export function declaresInsufficient(answer: string): boolean {
  return /(不足以回答|沒有足夠的核定原子命題|現有核定原子命題不足|無法根據現有原子命題)/.test(
    answer,
  );
}

/**
 * 把回答拆成句子，供逐句驗證。
 * 以句末標點切分，保留標點，並過濾純標題或空白行。
 */
export function splitAnswerSentences(answer: string): string[] {
  return answer
    .split("\n")
    .flatMap((line) => line.split(/(?<=[。！？!?])/u))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.replace(/\[K-\d{4}\]/g, "").trim().length >= 4);
}

/** 引用了證據包裡不存在的知識編號 → 幻覺訊號。 */
export function findUnknownCitations(answer: string, pack: EvidencePack): string[] {
  const known = new Set(pack.facts.map((fact) => fact.knowledge_id));
  return extractCitations(answer).filter((ref) => !known.has(ref));
}
