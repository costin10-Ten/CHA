/**
 * 待選原子命題包：匯出給其他 LLM 交叉校正，再把結果回填。
 *
 * 匯出包必須自帶說明，因為接手的模型沒有本專案的脈絡：
 *   - 每個欄位的意義與允許值，哪些欄位不可修改
 *   - 校正目標（不聳動、部會權責正確、科學正確性）
 *   - 回填格式與驗證規則
 *
 * 回填的內容一律重新跑品質檢查並進入待審核，不會直接變成核定原子命題。
 */

export const PACK_VERSION = 1;
export const PACK_KIND = "candidate-fact-pack";

/** 這些欄位屬於來源原子命題，任何模型都不得修改。 */
export const IMMUTABLE_FIELDS = [
  "id",
  "source_quote",
  "source_paragraph_id",
  "source_title",
  "source_url",
] as const;

export type ImmutableField = (typeof IMMUTABLE_FIELDS)[number];

export interface PackFact {
  id: string;
  statement: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  proposition_types: string[];
  risk_level: string;
  conditions: Record<string, string | null>;
  source_quote: string;
  source_paragraph_id: string;
  source_title: string | null;
  source_url: string | null;
  paragraph_text: string | null;
  quality_flags: string[];
  quality_score: number;
  status: string;
}

export interface FieldDoc {
  說明: string;
  可否修改: "可修改" | "不可修改";
  允許值?: string[];
  格式?: string;
}

export const FIELD_DOCS: Record<string, FieldDoc> = {
  id: {
    說明: "候選原子命題的唯一識別碼。回填時必須原樣帶回，用來比對是哪一筆。",
    可否修改: "不可修改",
    格式: "UUID",
  },
  statement: {
    說明:
      "單一原子命題的完整敘述。一句只講一件事，主詞必須完整（不可用「它」「該物質」開頭），" +
      "且內容必須能在 source_quote 中找到依據。",
    可否修改: "可修改",
  },
  subject: {
    說明: "原子命題的主體，例如物質、族群或機關名稱。",
    可否修改: "可修改",
  },
  predicate: {
    說明: "原子命題的關係或動作，例如「可能導致」「規定」。",
    可否修改: "可修改",
  },
  object: {
    說明: "原子命題的客體，例如健康影響、限值或對象。",
    可否修改: "可修改",
  },
  proposition_types: {
    說明:
      "原子命題的分類，**可複選**。九類同時涵蓋知識內容、事件類型與治理層級，" +
      "彼此本來就會重疊，適用幾類就填幾類；判斷不出來請給空陣列，不要硬塞。" +
      "health_advice（醫學健康建議）依規定只能用於政府機關來源。",
    可否修改: "可修改",
    允許值: [
      "substance_property（物質與物理化學性質）",
      "chemistry_concept（化學基本概念）",
      "event（事件）",
      "agency_topic（化學署主題）",
      "toxicology_mechanism（毒理與反應機制）",
      "domestic_policy（國內治理政策）",
      "foreign_policy（國外治理政策）",
      "research_literature（研究與期刊）",
      "health_advice（醫學健康建議，須為政府機關來源）",
    ],
  },
  risk_level: {
    說明: "風險等級。只反映敘述本身的風險溝通敏感度，不是危害程度評估。",
    可否修改: "可修改",
    允許值: ["low", "medium", "high"],
  },
  conditions: {
    說明:
      "原子命題的適用條件。原文有寫就必須保留，原文沒寫就填 null，不可自行推測。" +
      "鍵固定為 population（族群）、exposure_route（暴露途徑）、dose（劑量）、" +
      "duration（持續時間）、location（地點）、timeframe（時間範圍）。",
    可否修改: "可修改",
    格式: "物件，值為字串或 null",
  },
  source_quote: {
    說明: "原子命題所依據的原文片段。這是判斷原子命題是否超出原文的唯一依據，絕對不可修改或翻譯。",
    可否修改: "不可修改",
  },
  source_paragraph_id: {
    說明: "原文段落編號，例如 P-001。",
    可否修改: "不可修改",
  },
  source_title: { 說明: "來源文件標題，僅供參考。", 可否修改: "不可修改" },
  source_url: { 說明: "來源網址，僅供參考。", 可否修改: "不可修改" },
  paragraph_text: {
    說明: "原文段落全文，提供前後文以便判斷。僅供閱讀，不需回填。",
    可否修改: "不可修改",
  },
  quality_flags: {
    說明: "本系統自動品質檢查標記，說明這筆原子命題目前被懷疑的問題，供你優先處理。",
    可否修改: "不可修改",
  },
  quality_score: {
    說明: "自動品質分數（0-100），分數越低問題越多。",
    可否修改: "不可修改",
  },
  status: {
    說明: "目前審核狀態，匯出時通常是 pending（待審核）。",
    可否修改: "不可修改",
  },
};

export interface CorrectionGoal {
  目標: string;
  說明: string;
  檢查項目: string[];
}

/** 校正目標：使用者指定的三項，寫進匯出包讓外部模型照著做。 */
export const CORRECTION_GOALS: CorrectionGoal[] = [
  {
    目標: "不聳動",
    說明:
      "風險溝通的目的是讓人正確理解風險，不是製造恐慌。" +
      "敘述必須保留原文的不確定性，不得放大風險。",
    檢查項目: [
      "不得把「可能」「或許」「研究顯示」改寫成「會」「一定」「必然」",
      "不得使用「驚人」「恐怖」「毒害」「千萬別」等煽動性字眼",
      "不得省略原文中的限制條件讓風險看起來更普遍",
      "不得把個案或動物實驗結果寫成對一般人的普遍結論",
    ],
  },
  {
    目標: "部會權責正確",
    說明:
      "涉及主管機關時，權責歸屬必須正確。不確定就在 statement 中標記為「待確認」，" +
      "或把機關名稱移除只描述原子命題，不得猜測。",
    檢查項目: [
      "食品標示、食品添加物、食品衛生標準：衛生福利部食品藥物管理署",
      "農產品產地、農藥殘留與動物用藥管理：農業部",
      "環境污染、排放標準、土壤與水污染：環境部",
      "職業安全與作業環境暴露：勞動部職業安全衛生署",
      "原文沒有寫出主管機關時，不得自行補上",
    ],
  },
  {
    目標: "科學正確性",
    說明: "數值與科學關係必須與原文一致，不得因為要寫得順而改動。",
    檢查項目: [
      "數值、單位、年份、百分比不得更動（包括不得四捨五入或換算單位）",
      "劑量、暴露途徑、暴露時間、適用族群不得刪除或替換",
      "相關性不得寫成因果關係（「與…有關」不可改成「導致」）",
      "危害（hazard）與風險（risk）不得混用",
      "不得引入原文沒有的機制解釋或比較對象",
    ],
  },
];

export interface ReturnFormatDoc {
  說明: string;
  範例: unknown;
  規則: string[];
}

export const RETURN_FORMAT: ReturnFormatDoc = {
  說明:
    "把修改後的結果存成 JSON 檔回傳。只需要包含你有修改或有意見的原子命題，" +
    "沒有問題的可以不放。整包會重新跑品質檢查，並以「待審核」狀態進入系統，" +
    "不會直接成為正式原子命題。",
  範例: {
    pack_version: PACK_VERSION,
    kind: PACK_KIND,
    facts: [
      {
        id: "貼上原本的 id",
        statement: "修正後的單一原子命題敘述",
        subject: "主體",
        predicate: "關係",
        object: "客體",
        proposition_types: ["substance_property", "toxicology_mechanism"],
        risk_level: "medium",
        conditions: {
          population: "孕婦",
          exposure_route: null,
          dose: null,
          duration: null,
          location: null,
          timeframe: null,
        },
        correction_reason: "說明你改了什麼、依據哪一個校正目標",
        verdict: "revised",
      },
    ],
  },
  規則: [
    "id 必須原樣帶回，找不到對應 id 的項目會被拒絕",
    "不得修改 source_quote 與 source_paragraph_id；若一併回傳，內容必須與匯出時完全相同",
    "statement 必須能在 source_quote 中找到依據，找不到的會被系統擋下",
    "verdict 可填 ok（無需修改）、revised（已修正）、reject（建議刪除）、uncertain（需人工確認）",
    "correction_reason 請具體說明依據哪一個校正目標，不要只寫「潤飾」",
    "不得新增匯出包以外的原子命題",
  ],
};

export interface CandidatePack {
  pack_version: number;
  kind: string;
  generated_at: string;
  scope: string;
  fact_count: number;
  任務說明: string;
  欄位說明: Record<string, FieldDoc>;
  校正目標: CorrectionGoal[];
  回填格式: ReturnFormatDoc;
  facts: PackFact[];
}

const TASK_BRIEF =
  "以下是從文件中自動拆出的「候選原子命題」，尚未經人工核定。" +
  "請逐筆檢查每一句是否忠實反映 source_quote，並依照「校正目標」修正。" +
  "你只能依據 source_quote 與 paragraph_text 判斷，不得使用你自己的知識補充內容。" +
  "無法從原文判斷的，請填 verdict = uncertain 並說明原因，不要猜測。";

export function buildCandidatePack(
  facts: PackFact[],
  options: { scope: string; generatedAt?: string } = {
    scope: "全部待審核候選原子命題",
  },
): CandidatePack {
  return {
    pack_version: PACK_VERSION,
    kind: PACK_KIND,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    scope: options.scope,
    fact_count: facts.length,
    任務說明: TASK_BRIEF,
    欄位說明: FIELD_DOCS,
    校正目標: CORRECTION_GOALS,
    回填格式: RETURN_FORMAT,
    facts,
  };
}

export type ReturnedVerdict = "ok" | "revised" | "reject" | "uncertain";

export interface ReturnedFact {
  id: string;
  statement?: string;
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
  proposition_types?: string[];
  risk_level?: string;
  conditions?: Record<string, string | null>;
  source_quote?: string;
  source_paragraph_id?: string;
  correction_reason?: string;
  verdict?: ReturnedVerdict;
}

export interface ParsedPack {
  facts: ReturnedFact[];
  errors: string[];
}

const VERDICTS: ReturnedVerdict[] = ["ok", "revised", "reject", "uncertain"];
const PROPOSITION_TYPES = [
  "substance_property",
  "chemistry_concept",
  "event",
  "agency_topic",
  "toxicology_mechanism",
  "domestic_policy",
  "foreign_policy",
  "research_literature",
  "health_advice",
];
const RISK_LEVELS = ["low", "medium", "high"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * 解析回填的 JSON。
 * 這裡只做格式檢查；「是否忠於原文」由 checkFactQuality 在匯入時判斷。
 */
export function parseCandidatePack(input: unknown): ParsedPack {
  const errors: string[] = [];
  const root = asRecord(input);

  if (!root) {
    return { facts: [], errors: ["回填內容不是 JSON 物件"] };
  }

  if (typeof root.pack_version === "number" && root.pack_version !== PACK_VERSION) {
    errors.push(
      `pack_version 為 ${root.pack_version}，本系統目前只接受 ${PACK_VERSION}`,
    );
  }

  const rawFacts = Array.isArray(root.facts) ? root.facts : null;
  if (!rawFacts) {
    return { facts: [], errors: [...errors, "缺少 facts 陣列"] };
  }

  const facts: ReturnedFact[] = [];
  const seen = new Set<string>();

  rawFacts.forEach((item, index) => {
    const label = `第 ${index + 1} 筆`;
    const row = asRecord(item);
    if (!row) {
      errors.push(`${label}：不是物件`);
      return;
    }

    const id = asString(row.id)?.trim();
    if (!id) {
      errors.push(`${label}：缺少 id，無法對應回原本的候選原子命題`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`${label}：id ${id} 重複出現`);
      return;
    }
    seen.add(id);

    const fact: ReturnedFact = { id };

    const statement = asString(row.statement)?.trim();
    if (statement !== undefined && statement !== null) {
      if (statement.length === 0) {
        errors.push(`${label}：statement 是空字串`);
        return;
      }
      fact.statement = statement;
    }

    for (const key of ["subject", "predicate", "object"] as const) {
      if (key in row) fact[key] = asString(row[key]);
    }

    if ("proposition_types" in row) {
      const raw = row.proposition_types;
      if (!Array.isArray(raw)) {
        errors.push(`${label}：proposition_types 必須是陣列`);
        return;
      }
      const values = raw.map((item) => asString(item)).filter(Boolean) as string[];
      const invalid = values.filter((value) => !PROPOSITION_TYPES.includes(value));
      if (invalid.length > 0) {
        errors.push(
          `${label}：proposition_types「${invalid.join("、")}」不是允許值`,
        );
        return;
      }
      fact.proposition_types = [...new Set(values)];
    }

    if ("risk_level" in row) {
      const value = asString(row.risk_level);
      if (value && !RISK_LEVELS.includes(value)) {
        errors.push(`${label}：risk_level「${value}」不是允許值`);
        return;
      }
      if (value) fact.risk_level = value;
    }

    if ("conditions" in row) {
      const conditions = asRecord(row.conditions);
      if (!conditions) {
        errors.push(`${label}：conditions 不是物件`);
        return;
      }
      fact.conditions = Object.fromEntries(
        Object.entries(conditions).map(([key, value]) => [key, asString(value)]),
      );
    }

    if ("source_quote" in row) fact.source_quote = asString(row.source_quote) ?? "";
    if ("source_paragraph_id" in row) {
      fact.source_paragraph_id = asString(row.source_paragraph_id) ?? "";
    }

    const verdict = asString(row.verdict);
    if (verdict) {
      if (!VERDICTS.includes(verdict as ReturnedVerdict)) {
        errors.push(`${label}：verdict「${verdict}」不是允許值`);
        return;
      }
      fact.verdict = verdict as ReturnedVerdict;
    }

    const reason = asString(row.correction_reason);
    if (reason) fact.correction_reason = reason;

    facts.push(fact);
  });

  return { facts, errors };
}

/**
 * 檢查回填是否動到不可修改的欄位。
 * 回傳被動到的欄位名稱；空陣列表示通過。
 */
export function findImmutableViolations(
  returned: ReturnedFact,
  original: Pick<PackFact, "source_quote" | "source_paragraph_id">,
): ImmutableField[] {
  const violations: ImmutableField[] = [];

  if (
    returned.source_quote !== undefined &&
    returned.source_quote !== original.source_quote
  ) {
    violations.push("source_quote");
  }
  if (
    returned.source_paragraph_id !== undefined &&
    returned.source_paragraph_id !== original.source_paragraph_id
  ) {
    violations.push("source_paragraph_id");
  }

  return violations;
}
