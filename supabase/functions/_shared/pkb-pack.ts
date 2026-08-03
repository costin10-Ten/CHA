/**
 * 個人原子知識庫的匯入包驗證。
 *
 * 沿用 CHA 文章包的「寬進嚴審」精神——欄位別名、中文列舉值、逐筆跳過，
 * 一筆有問題不會拖垮整包——但規則差很多：
 *
 *   CHA：引句必須逐字存在於來源文件的某一段，對不上就退回待審核
 *   PKB：不比對原文，只要求「說得出這句話從哪來」
 *
 * 因此唯一的硬性要求是 statement 與 source_label。
 * 來源分類認不出來時退到 other，而不是擋下——分類是為了篩選，
 * 不是為了把關；真正承擔可信度的是 source_label 與 source_url。
 *
 * CHA 匯出的文章包可以直接丟進來：`source.title` 當作來源名稱、
 * `proposition_types` 併進 tags，資訊不會掉。
 */

export const PKB_SOURCE_TYPES = [
  "popular_science",
  "domestic_law",
  "own_duty",
  "moenv_news",
  "foreign_regulation",
  "foreign_news",
  "ministry_priority",
  "mock_question",
  "formal_idea",
  "other",
] as const;

export type PkbSourceType = (typeof PKB_SOURCE_TYPES)[number];

/** 自製內容：不是外部依據，匯出給其他 LLM 時要能區分。 */
export const SELF_AUTHORED_TYPES: PkbSourceType[] = [
  "mock_question",
  "formal_idea",
];

const SOURCE_TYPE_ALIASES: Record<string, PkbSourceType> = {
  科普文章: "popular_science",
  科普: "popular_science",
  popular_science: "popular_science",

  國內法規: "domestic_law",
  法規: "domestic_law",
  國內法令: "domestic_law",
  domestic_law: "domestic_law",

  本署業務: "own_duty",
  本屬業務: "own_duty",
  署內業務: "own_duty",
  業務: "own_duty",
  own_duty: "own_duty",

  環境部新聞: "moenv_news",
  部內新聞: "moenv_news",
  moenv_news: "moenv_news",

  國外管理制度: "foreign_regulation",
  國外制度: "foreign_regulation",
  國外法規: "foreign_regulation",
  foreign_regulation: "foreign_regulation",

  國外最新新聞: "foreign_news",
  國外新聞: "foreign_news",
  國際新聞: "foreign_news",
  foreign_news: "foreign_news",

  本部重點推動: "ministry_priority",
  重點推動: "ministry_priority",
  ministry_priority: "ministry_priority",

  模擬題: "mock_question",
  mock_question: "mock_question",

  正式發想點: "formal_idea",
  發想點: "formal_idea",
  發想: "formal_idea",
  formal_idea: "formal_idea",

  其他: "other",
  other: "other",
};

/**
 * CHA 的 `source.source_type` 是 text／file／url（原文怎麼來的），
 * 與這裡的九類來源分類完全是兩件事。看到這幾個值要當作「沒填」，
 * 不能讓它們變成 other——那會讓每一筆沿用過來的知識都掉進「其他」。
 */
const CHA_SOURCE_TYPES = new Set(["text", "file", "url"]);

const STATUS_APPROVED = new Set([
  "approved",
  "active",
  "核定",
  "已核定",
  "同意",
  "已同意",
  "通過",
]);

const STATUS_REJECTED = new Set([
  "rejected",
  "trashed",
  "駁回",
  "已駁回",
  "不通過",
  "垃圾桶",
]);

export interface PkbPackItem {
  ref: string;
  statement: string;
  source_type: PkbSourceType;
  source_label: string;
  source_url: string | null;
  source_note: string | null;
  is_self_authored: boolean;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  tags: string[];
  /** 檔案標示已同意；匯入畫面勾選「沿用」時才會直接變成 active。 */
  approved_in_pack: boolean;
}

export interface PkbIssue {
  level: "error" | "warning";
  where: string;
  message: string;
  hint?: string;
}

export interface PkbSummary {
  items: number;
  approvedInPack: number;
  /** 檔案標示駁回、略過不匯入的筆數。 */
  rejected: number;
  /** 缺欄位被跳過的筆數。 */
  skipped: number;
  selfAuthored: number;
  bySourceType: Record<string, number>;
}

export interface PkbValidation {
  ok: boolean;
  items: PkbPackItem[];
  issues: PkbIssue[];
  summary: PkbSummary;
  /** 整包共用的來源資訊，逐筆沒寫時沿用。 */
  defaultSourceLabel: string | null;
}

// --- 小工具 ----------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row && row[key] !== null && row[key] !== undefined) {
      return row[key];
    }
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 底線開頭的欄位是給人看的註解，不是資料。 */
function stripNotes(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith("_")),
  );
}

export function normalizeSourceType(raw: unknown): {
  value: PkbSourceType | null;
  unrecognized: string | null;
} {
  const input = text(raw).trim();
  if (!input) return { value: null, unrecognized: null };
  if (CHA_SOURCE_TYPES.has(input.toLowerCase())) {
    return { value: null, unrecognized: null };
  }

  const mapped =
    SOURCE_TYPE_ALIASES[input] ?? SOURCE_TYPE_ALIASES[input.toLowerCase()];
  if (mapped) return { value: mapped, unrecognized: null };

  return { value: null, unrecognized: input };
}

function normalizeTags(...sources: unknown[]): string[] {
  const tags: string[] = [];
  for (const source of sources) {
    const values = Array.isArray(source)
      ? source
      : text(source)
          .split(/[、，,／/|]/u)
          .filter(Boolean);
    for (const value of values) {
      const tag = text(value).trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

// --- 主流程 ----------------------------------------------------------------

export function validatePkbPack(input: unknown): PkbValidation {
  const issues: PkbIssue[] = [];
  const empty: PkbSummary = {
    items: 0,
    approvedInPack: 0,
    rejected: 0,
    skipped: 0,
    selfAuthored: 0,
    bySourceType: {},
  };

  const root = asRecord(input);
  if (!root) {
    issues.push({ level: "error", where: "檔案", message: "不是 JSON 物件" });
    return {
      ok: false,
      items: [],
      issues,
      summary: empty,
      defaultSourceLabel: null,
    };
  }

  // 整包共用的來源。CHA 的文章包把它放在 source／sources[0]。
  const source =
    asRecord(pick(root, "source", "來源")) ??
    asRecord(asArray(pick(root, "sources"))[0]) ??
    {};

  const defaultLabel =
    text(pick(source, "title", "label", "name", "標題", "來源名稱")).trim() ||
    text(pick(root, "title", "來源名稱")).trim() ||
    null;

  const defaultUrl =
    text(pick(source, "origin_url", "url", "link", "網址")).trim() || null;

  const defaultTypeResult = normalizeSourceType(
    pick(source, "source_type", "category", "type", "來源分類", "分類") ??
      pick(root, "source_type", "來源分類"),
  );

  if (defaultTypeResult.unrecognized) {
    issues.push({
      level: "warning",
      where: "source.source_type",
      message: `來源分類「${defaultTypeResult.unrecognized}」無法辨識，改用「其他」`,
      hint: "九類：科普文章、國內法規、本署業務、環境部新聞、國外管理制度、國外最新新聞、本部重點推動、模擬題、正式發想點。",
    });
  }

  const rows = asArray(
    pick(
      root,
      "items",
      "facts",
      "candidate_facts",
      "candidates",
      "knowledge",
      "原子知識",
      "原子命題",
      "命題",
      "事實",
      "知識",
    ),
  );

  if (rows.length === 0) {
    issues.push({
      level: "error",
      where: "檔案",
      message: "找不到任何原子知識",
      hint: "清單欄位可以叫 items、facts、原子知識、知識…；每一筆至少要有 statement。",
    });
    return {
      ok: false,
      items: [],
      issues,
      summary: empty,
      defaultSourceLabel: defaultLabel,
    };
  }

  const items: PkbPackItem[] = [];
  const summary: PkbSummary = { ...empty, bySourceType: {} };
  const seenRefs = new Set<string>();
  const rejectedRefs: string[] = [];

  rows.forEach((raw, index) => {
    const row = asRecord(raw);
    if (!row) return;

    const clean = stripNotes(row);
    const ref =
      text(pick(clean, "ref", "id", "code", "編號")).trim() ||
      `K${String(index + 1).padStart(3, "0")}`;
    const where = `第 ${index + 1} 筆（${ref}）`;

    if (seenRefs.has(ref)) {
      issues.push({ level: "warning", where, message: "編號重複，保留第一筆" });
      return;
    }
    seenRefs.add(ref);

    const statement = text(
      pick(
        clean,
        "statement",
        "fact",
        "sentence",
        "text",
        "knowledge",
        "敘述",
        "原子知識",
        "命題",
        "事實",
      ),
    ).trim();

    if (statement.length < 2) {
      summary.skipped += 1;
      issues.push({
        level: "error",
        where,
        message: "沒有知識敘述，這一筆跳過",
      });
      return;
    }

    // 檔案標示駁回的不匯入。理由與 CHA 相同：已經判定不成立的句子
    // 進了資料庫，只會躺在待同意清單裡等著被一起放行。
    const statusRaw = text(pick(clean, "status", "decision", "審核狀態", "狀態"))
      .trim()
      .toLowerCase();
    const statusOriginal = text(
      pick(clean, "status", "decision", "審核狀態", "狀態"),
    ).trim();

    if (STATUS_REJECTED.has(statusRaw) || STATUS_REJECTED.has(statusOriginal)) {
      rejectedRefs.push(ref);
      summary.rejected += 1;
      return;
    }

    // 來源分類：逐筆優先，沒寫就用整包的。
    const rowType = normalizeSourceType(
      pick(clean, "source_type", "category", "來源分類", "分類", "來源"),
    );
    if (rowType.unrecognized) {
      issues.push({
        level: "warning",
        where,
        message: `來源分類「${rowType.unrecognized}」無法辨識，改用「其他」`,
      });
    }

    const sourceType: PkbSourceType =
      rowType.value ??
      (rowType.unrecognized
        ? "other"
        : (defaultTypeResult.value ??
          (defaultTypeResult.unrecognized ? "other" : "other")));

    if (!rowType.value && !defaultTypeResult.value && !rowType.unrecognized) {
      issues.push({
        level: "warning",
        where,
        message: "沒有來源分類，改用「其他」",
        hint: "在整包的 source 或逐筆加上 source_type，之後才篩得動。",
      });
    }

    const sourceLabel =
      text(
        pick(clean, "source_label", "source_title", "source", "來源名稱", "出處"),
      ).trim() || defaultLabel;

    if (!sourceLabel) {
      summary.skipped += 1;
      issues.push({
        level: "error",
        where,
        message: "沒有來源名稱，這一筆跳過",
        hint: "這一版不比對原文，來源名稱是唯一能說明「這句話從哪來」的欄位，所以必填。可以寫在整包的 source.title 讓每一筆共用。",
      });
      return;
    }

    const item: PkbPackItem = {
      ref,
      statement,
      source_type: sourceType,
      source_label: sourceLabel,
      source_url:
        text(pick(clean, "source_url", "url", "link", "網址")).trim() || defaultUrl,
      source_note:
        text(
          pick(clean, "source_note", "note", "備註", "說明", "review_note"),
        ).trim() || null,
      is_self_authored: SELF_AUTHORED_TYPES.includes(sourceType),
      subject: text(pick(clean, "subject", "主體")).trim() || null,
      predicate: text(pick(clean, "predicate", "關係")).trim() || null,
      object: text(pick(clean, "object", "客體")).trim() || null,
      // CHA 的命題分類併進標籤，資訊不會掉。
      tags: normalizeTags(
        pick(clean, "tags", "標籤"),
        pick(clean, "proposition_types", "命題分類"),
      ),
      approved_in_pack:
        STATUS_APPROVED.has(statusRaw) || STATUS_APPROVED.has(statusOriginal),
    };

    items.push(item);
    summary.items += 1;
    if (item.approved_in_pack) summary.approvedInPack += 1;
    if (item.is_self_authored) summary.selfAuthored += 1;
    summary.bySourceType[sourceType] = (summary.bySourceType[sourceType] ?? 0) + 1;
  });

  if (rejectedRefs.length > 0) {
    issues.push({
      level: "warning",
      where: "清單",
      message: `略過 ${rejectedRefs.length} 筆標示駁回的知識（${rejectedRefs
        .slice(0, 5)
        .join("、")}${rejectedRefs.length > 5 ? " 等" : ""}）`,
      hint: "駁回代表這句話不成立，建進資料庫只會增加被誤放行的機會。要留紀錄請留在檔案裡。",
    });
  }

  if (items.length === 0) {
    issues.push({
      level: "error",
      where: "檔案",
      message:
        rejectedRefs.length > 0
          ? "所有知識都標示駁回，沒有可匯入的內容"
          : "沒有任何可匯入的知識",
    });
  }

  return {
    ok: items.length > 0,
    items,
    issues,
    summary,
    defaultSourceLabel: defaultLabel,
  };
}

/** 供介面顯示。 */
export const PKB_SOURCE_TYPE_LABEL: Record<PkbSourceType, string> = {
  popular_science: "科普文章",
  domestic_law: "國內法規",
  own_duty: "本署業務",
  moenv_news: "環境部新聞",
  foreign_regulation: "國外管理制度",
  foreign_news: "國外最新新聞",
  ministry_priority: "本部重點推動",
  mock_question: "模擬題",
  formal_idea: "正式發想點",
  other: "其他",
};
