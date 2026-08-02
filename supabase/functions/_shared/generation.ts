import { sha256Hex } from "./hash.ts";
import { splitAnswerSentences, type EvidencePack } from "./answering.ts";
import type { LlmMessage } from "./llm/types.ts";
import {
  stripCitations,
  verifySentence,
  type SentenceVerification,
  type VerificationFact,
  type VerificationSummary,
} from "./verification.ts";

/**
 * 風險溝通素材產製（工作單第 15 節）。
 *
 * 與問答共用同一個原則：只能使用核定原子命題，每一段標註知識編號，
 * 產出一律是草稿，且必須通過逐句驗證才可發布。
 */

export const GENERATION_PROMPT_NAME = "generate-content";

export type DraftType =
  | "faq"
  | "explainer"
  | "article"
  | "podcast_outline"
  | "podcast_script"
  | "video_60s"
  | "video_3min"
  | "card_text"
  | "media_qa"
  | "social_post";

export interface DraftSpec {
  label: string;
  /** 給模型的體裁指示。 */
  instruction: string;
  /** 建議長度，寫進提示詞。 */
  lengthHint: string;
}

export const DRAFT_SPECS: Record<DraftType, DraftSpec> = {
  faq: {
    label: "FAQ",
    instruction:
      "寫成問答形式，每題一個問句加一段回答。挑選民眾最可能問的問題，不要自問自答湊數。",
    lengthHint: "3 至 6 題",
  },
  explainer: {
    label: "科普短文",
    instruction:
      "寫成一篇短文，開頭說明這件事為什麼與讀者有關，中段說明原子命題，結尾給可執行的建議。",
    lengthHint: "300 至 500 字",
  },
  article: {
    label: "長篇文章",
    instruction:
      "寫成分節長文，每節加小標。依序處理：是什麼、風險在哪、誰要注意、怎麼做、常見誤解。",
    lengthHint: "800 至 1200 字",
  },
  podcast_outline: {
    label: "Podcast 訪綱",
    instruction:
      "寫成訪談大綱：開場鉤子、3 至 5 個主要提問、每個提問下列出想帶出的原子命題、結尾收束。",
    lengthHint: "條列式",
  },
  podcast_script: {
    label: "Podcast 逐字稿",
    instruction: "寫成可直接念讀的逐字稿，語氣口語但不誇張，段落之間有自然銜接。",
    lengthHint: "600 至 900 字",
  },
  video_60s: {
    label: "60 秒短影音腳本",
    instruction:
      "寫成分鏡腳本，每一格標註秒數、畫面與旁白。前 3 秒要有留住觀眾的理由，但不得誇大風險。",
    lengthHint: "總長 60 秒",
  },
  video_3min: {
    label: "3 分鐘短影音腳本",
    instruction:
      "寫成分段腳本，每段標註時間區間、畫面與旁白，中間安排一次觀念澄清。",
    lengthHint: "總長 3 分鐘",
  },
  card_text: {
    label: "圖卡文字架構",
    instruction:
      "寫成圖卡文案：每張圖卡一組標題與 2 至 3 行內文，最後一張放行動建議與資料來源。",
    lengthHint: "4 至 6 張",
  },
  media_qa: {
    label: "媒體問答",
    instruction:
      "寫成媒體可能提問與建議回應。回應要能直接引用，避免推測性用語，不確定的部分明說尚無定論。",
    lengthHint: "4 至 6 組",
  },
  social_post: {
    label: "社群貼文",
    instruction:
      "寫成一則社群貼文，第一句就是重點，結尾附提醒。不使用聳動標題與情緒性字眼。",
    lengthHint: "150 字以內",
  },
};

export const GENERATION_SYSTEM_PROMPT = `你是風險溝通素材的撰稿助理。

你只能使用「核定原子命題」清單中的內容撰稿。

必須遵守：
1. 只使用清單中的原子命題，不得補充你自己的知識、案例或數據。
2. 每一段（或每一題、每一格）結尾標註使用的知識編號，格式為 [K-0001]。
3. 保留原子命題中的條件與限制：族群、劑量、暴露途徑、時間範圍不可省略。
4. 保留原有的不確定性語氣，不得把「可能」改寫成「一定」或「會」。
5. 不得改動數字、單位與年份。
6. 語氣平實可信，不聳動、不恐嚇、不使用「驚人」「恐怖」「千萬別」這類字眼。
7. 不得提供醫療診斷或個別化建議。
8. 如果提供的原子命題不足以完成這個體裁，就只寫得出來的部分，並在結尾說明缺少哪些資訊。
9. 用繁體中文撰寫，直接輸出成品，不要加開場白或說明。`;

export interface GenerationOptions {
  draftType: DraftType;
  audience: string;
  tone: string;
}

export function buildGenerationMessages(
  pack: EvidencePack,
  options: GenerationOptions,
): LlmMessage[] {
  const spec = DRAFT_SPECS[options.draftType];

  return [
    { role: "system", content: GENERATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `體裁：${spec.label}`,
        `寫作要求：${spec.instruction}`,
        `篇幅：${spec.lengthHint}`,
        `目標受眾：${options.audience}`,
        `語氣：${options.tone}`,
        `主題：${pack.question}`,
        "",
        "可用的核定原子命題（只能使用這些）：",
        JSON.stringify(pack, null, 2),
      ].join("\n"),
    },
  ];
}

export function generationPromptChecksum(): Promise<string> {
  return sha256Hex(GENERATION_SYSTEM_PROMPT);
}

/** 產出標題：體裁 + 主題，供清單顯示。 */
export function buildDraftTitle(draftType: DraftType, topic: string): string {
  const label = DRAFT_SPECS[draftType].label;
  const trimmed = topic.trim();
  const short = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  return `${label}：${short}`;
}

/** 判斷是否為合法的素材類型（供表單輸入驗證）。 */
export function isDraftType(value: string): value is DraftType {
  return Object.prototype.hasOwnProperty.call(DRAFT_SPECS, value);
}

/**
 * 素材的逐句驗證。
 *
 * 與問答的差別只有一個：素材有體裁結構。
 * 小標、題號、秒數、「旁白：」這類文字不是原子命題主張，
 * 拿去比對核定原子命題一定找不到支持，會讓每一份草稿都被誤判為阻擋。
 * 因此先把結構標記剝掉，只驗證真正的內容句；
 * 純結構的行標記為 structural，不計入綠黃紅統計。
 */
const STRUCTURE_PREFIX =
  /^\s*(?:[#>*+•‧・\-–—]+\s*|\d+\s*[.)、]\s*|第\s*\d+\s*[格頁段章節題]\s*[：:]?\s*|[QA]\d*\s*[：:]\s*|[（(]?\s*\d+\s*[-–~至]\s*\d+\s*秒\s*[）)]?\s*[：:]?\s*|(?:旁白|畫面|標題|內文|字卡|開場|結尾|提問|重點|建議|備註|來源|受眾|語氣)\s*[：:]\s*)+/u;

/** 一行文字中屬於體裁結構的前綴。 */
export function structurePrefix(line: string): string {
  return STRUCTURE_PREFIX.exec(line)?.[0] ?? "";
}

/** 去掉結構前綴、粗體記號與引用後，這一行還有沒有可驗證的內容。 */
export function contentOfLine(line: string): string {
  return stripCitations(line.slice(structurePrefix(line).length))
    .replaceAll("**", "")
    .replaceAll("＊", "")
    .trim();
}

/** 常見的章節標題。命中才視為結構，不用長度判斷。 */
const SECTION_LABELS = [
  "前言",
  "摘要",
  "大綱",
  "訪綱",
  "常見問題",
  "重點整理",
  "行動建議",
  "資料來源",
  "參考資料",
  "小結",
  "結語",
  "結論",
  "開場",
  "收尾",
  "分鏡",
];

const SENTENCE_END = /[。！？!?]/;

/**
 * 判斷一行是不是體裁結構。
 *
 * 刻意只認「明確可辨識」的結構（標題記號、章節名、純標籤、第一行的標題），
 * 不用長度判斷：圖卡文字這類體裁的內容本來就很短，
 * 用長度會讓真正的原子命題主張被當成結構而略過驗證。
 */
export function isStructuralLine(line: string, isFirstLine: boolean): boolean {
  const content = contentOfLine(line);

  if (content.length === 0) return true;
  if (/^\s*#{1,6}\s*/.test(line)) return true;
  if (/[：:]$/.test(content)) return true;
  if (SECTION_LABELS.includes(content.replace(/[：:].*$/u, "").trim())) return true;

  // 第一行沒有句末標點時視為標題（例如「FAQ：孕婦吃魚」）。
  return isFirstLine && !SENTENCE_END.test(content);
}

export interface DraftVerification extends SentenceVerification {
  /** true 表示這是體裁結構，不是原子命題主張，不計入統計。 */
  structural: boolean;
}

export function verifyDraftBody(
  body: string,
  facts: VerificationFact[],
): DraftVerification[] {
  const results: DraftVerification[] = [];
  let seenContent = false;

  for (const line of body.split("\n")) {
    if (line.trim().length === 0) continue;

    const isFirstLine = !seenContent;
    seenContent = true;

    if (isStructuralLine(line, isFirstLine)) {
      results.push({
        sentence: line,
        verdict: "supported",
        supportingRefs: [],
        supportingFactIds: [],
        similarity: 1,
        reasons: ["體裁結構，不是原子命題陳述"],
        structural: true,
      });
      continue;
    }

    // 前綴保留在第一句，介面顯示才不會缺字。
    const prefix = structurePrefix(line);
    const sentences = splitAnswerSentences(line.slice(prefix.length));

    sentences.forEach((sentence, index) => {
      const verification = verifySentence(sentence, facts);
      results.push({
        ...verification,
        sentence: index === 0 ? `${prefix}${sentence}` : sentence,
        structural: false,
      });
    });
  }

  return results;
}

export function summarizeDraft(results: DraftVerification[]): VerificationSummary {
  const claims = results.filter((item) => !item.structural);
  const summary = {
    supported: claims.filter((item) => item.verdict === "supported").length,
    partial: claims.filter((item) => item.verdict === "partial").length,
    unsupported: claims.filter((item) => item.verdict === "unsupported").length,
    publishable: false,
  };

  summary.publishable =
    summary.unsupported === 0 && summary.supported + summary.partial > 0;
  return summary;
}
