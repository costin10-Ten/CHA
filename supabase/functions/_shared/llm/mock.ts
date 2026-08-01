import {
  estimateTokens,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "./types.ts";

/**
 * Mock Provider：不呼叫任何外部 API 的確定性實作。
 *
 * 行為刻意貼近真實抽取的輸出形狀：把段落切成句子，每句產生一筆候選事實，
 * 並以該句原文作為 source_quote。這樣品質檢查與整個流程都能在測試中跑完整條路徑。
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";

  constructor(readonly model: string = "mock-extractor-1") {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const userContent = request.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");

    const text = isAnswerPrompt(userContent)
      ? buildMockAnswer(userContent)
      : JSON.stringify({ facts: buildMockFacts(userContent) });

    return {
      text,
      model: this.model,
      provider: this.name,
      inputTokens: estimateTokens(userContent),
      outputTokens: estimateTokens(text),
      latencyMs: Math.max(1, Date.now() - started),
    };
  }
}

/** 問答提示詞由 answering.ts 產生，內容一定包含證據包標題。 */
export function isAnswerPrompt(prompt: string): boolean {
  return prompt.includes("證據包（只能使用這些事實）");
}

/**
 * Mock 回答：直接引用證據包裡的事實並標註知識編號。
 * 不會捏造內容，因此可以用來驗證引用、逐句驗證與阻擋機制。
 */
export function buildMockAnswer(prompt: string): string {
  const start = prompt.indexOf("{");
  const end = prompt.lastIndexOf("}");
  if (start === -1 || end === -1) {
    return "現有核定事實不足以回答這個問題。";
  }

  let pack: { facts?: { knowledge_id?: string; statement?: string }[] };
  try {
    pack = JSON.parse(prompt.slice(start, end + 1));
  } catch {
    return "現有核定事實不足以回答這個問題。";
  }

  const facts = (pack.facts ?? []).filter(
    (fact) => fact.statement && fact.knowledge_id,
  );

  if (facts.length === 0) {
    return "現有核定事實不足以回答這個問題，知識庫中沒有相關的核定事實。";
  }

  return facts
    .slice(0, 5)
    .map((fact) => `${fact.statement} [${fact.knowledge_id}]`)
    .join("\n\n");
}

interface MockParagraph {
  paragraphId: string;
  text: string;
}

/**
 * 從提示詞中還原段落。提示詞格式由 extraction.ts 產生：
 * 每段以 `[P-001] 內容` 起始。
 */
export function parseParagraphsFromPrompt(prompt: string): MockParagraph[] {
  const paragraphs: MockParagraph[] = [];
  for (const line of prompt.split("\n")) {
    const match = /^\[(P-\d+)\]\s*(.+)$/.exec(line.trim());
    if (match) {
      paragraphs.push({ paragraphId: match[1], text: match[2].trim() });
    }
  }
  return paragraphs;
}

/** 以句號、驚嘆號、問號、分號切句，保留標點。 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
}

const HEDGE_PATTERN = /(可能|或許|也許|研究顯示|建議|推測|尚未確定|不一定)/;

function buildMockFacts(prompt: string): Record<string, unknown>[] {
  const facts: Record<string, unknown>[] = [];

  for (const paragraph of parseParagraphsFromPrompt(prompt)) {
    for (const sentence of splitSentences(paragraph.text)) {
      facts.push({
        statement: sentence,
        subject: sentence.slice(0, Math.min(8, sentence.length)),
        predicate: null,
        object: null,
        knowledge_type: "other",
        conditions: {
          population: null,
          exposure_route: null,
          dose: null,
          duration: null,
          location: null,
          timeframe: null,
        },
        source_quote: sentence,
        source_paragraph_id: paragraph.paragraphId,
        risk_level: HEDGE_PATTERN.test(sentence) ? "medium" : "low",
        confidence: 0.6,
      });
    }
  }

  return facts;
}
