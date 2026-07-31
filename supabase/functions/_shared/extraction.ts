import { sha256Hex } from "./hash.ts";
import type { JsonSchema, LlmMessage } from "./llm/types.ts";

/**
 * 候選事實抽取的提示詞、JSON Schema 與回應解析。
 * 提示詞內容變動時 checksum 會改變，資料庫會自動建立新的 prompt_version。
 */

export const EXTRACTION_PROMPT_NAME = "extract-facts";

export const EXTRACTION_SYSTEM_PROMPT = `你是風險溝通知識庫的事實拆解助理。

任務：把提供的段落拆成「一句一事」的候選事實。

必須遵守：
1. 每一筆事實只表達一個可驗證的命題。
2. 每一筆事實單獨閱讀就能理解，不可使用「這個」「該物質」等指代詞，主詞要完整。
3. 不得超出原文內容，不得加入原文沒有的知識、推論或背景。
4. 必須保留條件、限制與不確定性：族群、暴露途徑、劑量、時間、地點、期間。
5. 必須保留數字、單位、年份與族群，數值不可四捨五入或改寫。
6. 原文若使用「可能」「研究顯示」「建議」等語氣，事實敘述必須保留同樣的不確定性，不可改寫成確定語氣。
7. source_quote 必須是原文中「一字不改」的連續片段，且足以支持該事實。
8. source_paragraph_id 必須是提供段落的編號（例如 P-003）。
9. 沒有原文片段可支持的內容，就不要輸出。
10. 只輸出 JSON，不要有任何說明文字或程式碼區塊記號。

輸出格式：
{"facts": [{"statement": "...", "subject": "...", "predicate": "...", "object": "...", "knowledge_type": "substance|concept|policy|event|topic|other", "conditions": {"population": null, "exposure_route": null, "dose": null, "duration": null, "location": null, "timeframe": null}, "source_quote": "...", "source_paragraph_id": "P-001", "risk_level": "low|medium|high", "confidence": 0.0}]}`;

export const EXTRACTION_JSON_SCHEMA: JsonSchema = {
  name: "candidate_facts",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["facts"],
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "statement",
            "knowledge_type",
            "conditions",
            "source_quote",
            "source_paragraph_id",
            "risk_level",
            "confidence",
          ],
          properties: {
            statement: { type: "string", minLength: 1 },
            subject: { type: ["string", "null"] },
            predicate: { type: ["string", "null"] },
            object: { type: ["string", "null"] },
            knowledge_type: {
              type: "string",
              enum: ["substance", "concept", "policy", "event", "topic", "other"],
            },
            conditions: {
              type: "object",
              additionalProperties: false,
              properties: {
                population: { type: ["string", "null"] },
                exposure_route: { type: ["string", "null"] },
                dose: { type: ["string", "null"] },
                duration: { type: ["string", "null"] },
                location: { type: ["string", "null"] },
                timeframe: { type: ["string", "null"] },
              },
            },
            source_quote: { type: "string", minLength: 1 },
            source_paragraph_id: { type: "string", pattern: "^P-\\d+$" },
            risk_level: { type: "string", enum: ["low", "medium", "high"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
};

export interface ExtractionParagraph {
  paragraphId: string;
  text: string;
  headingPath?: string[];
}

export interface FactConditions {
  population: string | null;
  exposure_route: string | null;
  dose: string | null;
  duration: string | null;
  location: string | null;
  timeframe: string | null;
}

export interface RawFact {
  statement: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  knowledge_type: string;
  conditions: FactConditions;
  source_quote: string;
  source_paragraph_id: string;
  risk_level: string;
  confidence: number;
}

export const EMPTY_CONDITIONS: FactConditions = {
  population: null,
  exposure_route: null,
  dose: null,
  duration: null,
  location: null,
  timeframe: null,
};

const KNOWLEDGE_TYPES = [
  "substance",
  "concept",
  "policy",
  "event",
  "topic",
  "other",
];
const RISK_LEVELS = ["low", "medium", "high"];

export function buildExtractionMessages(
  documentTitle: string,
  paragraphs: ExtractionParagraph[],
): LlmMessage[] {
  const body = paragraphs
    .map((paragraph) => {
      const heading = paragraph.headingPath?.length
        ? `（章節：${paragraph.headingPath.join(" › ")}）`
        : "";
      return `[${paragraph.paragraphId}]${heading} ${paragraph.text}`;
    })
    .join("\n");

  return [
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    {
      role: "user",
      content: `文件標題：${documentTitle}\n\n以下是需要拆解的段落，每段前面是段落編號：\n${body}`,
    },
  ];
}

/** 提示詞版本識別碼：內容變動就會產生新的 checksum。 */
export function promptChecksum(template: string): Promise<string> {
  return sha256Hex(template);
}

/** 去除模型可能加上的程式碼區塊記號與前後說明文字。 */
export function extractJsonBlock(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return candidate;
  return candidate.slice(start, end + 1);
}

export interface ParseResult {
  facts: RawFact[];
  /** 被丟棄的項目與原因，供工作結果紀錄。 */
  discarded: { reason: string; raw: unknown }[];
}

/**
 * 解析模型輸出。
 * 缺少必要欄位或型別不符的項目直接丟棄，不讓半成品進入審核流程。
 */
export function parseFactsResponse(text: string): ParseResult {
  const discarded: ParseResult["discarded"] = [];

  let payload: unknown;
  try {
    payload = JSON.parse(extractJsonBlock(text));
  } catch {
    return { facts: [], discarded: [{ reason: "回應不是合法 JSON", raw: text }] };
  }

  const rawFacts =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { facts?: unknown }).facts)
      ? ((payload as { facts: unknown[] }).facts as unknown[])
      : null;

  if (!rawFacts) {
    return {
      facts: [],
      discarded: [{ reason: "回應缺少 facts 陣列", raw: payload }],
    };
  }

  const facts: RawFact[] = [];

  for (const item of rawFacts) {
    if (!item || typeof item !== "object") {
      discarded.push({ reason: "項目不是物件", raw: item });
      continue;
    }

    const record = item as Record<string, unknown>;
    const statement =
      typeof record.statement === "string" ? record.statement.trim() : "";
    const quote =
      typeof record.source_quote === "string" ? record.source_quote.trim() : "";
    const paragraphId =
      typeof record.source_paragraph_id === "string"
        ? record.source_paragraph_id.trim()
        : "";

    if (!statement) {
      discarded.push({ reason: "缺少 statement", raw: item });
      continue;
    }
    if (!quote) {
      discarded.push({ reason: "缺少 source_quote", raw: item });
      continue;
    }
    if (!/^P-\d+$/.test(paragraphId)) {
      discarded.push({ reason: "source_paragraph_id 格式不正確", raw: item });
      continue;
    }

    const knowledgeType =
      typeof record.knowledge_type === "string" &&
      KNOWLEDGE_TYPES.includes(record.knowledge_type)
        ? record.knowledge_type
        : "other";

    const riskLevel =
      typeof record.risk_level === "string" &&
      RISK_LEVELS.includes(record.risk_level)
        ? record.risk_level
        : "low";

    const confidenceValue = Number(record.confidence);
    const confidence = Number.isFinite(confidenceValue)
      ? Math.min(1, Math.max(0, confidenceValue))
      : 0;

    facts.push({
      statement,
      subject: optionalString(record.subject),
      predicate: optionalString(record.predicate),
      object: optionalString(record.object),
      knowledge_type: knowledgeType,
      conditions: normalizeConditions(record.conditions),
      source_quote: quote,
      source_paragraph_id: paragraphId,
      risk_level: riskLevel,
      confidence,
    });
  }

  return { facts, discarded };
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeConditions(value: unknown): FactConditions {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    population: optionalString(source.population),
    exposure_route: optionalString(source.exposure_route),
    dose: optionalString(source.dose),
    duration: optionalString(source.duration),
    location: optionalString(source.location),
    timeframe: optionalString(source.timeframe),
  };
}

export function hasAnyCondition(conditions: FactConditions): boolean {
  return Object.values(conditions).some((value) => value !== null && value !== "");
}
