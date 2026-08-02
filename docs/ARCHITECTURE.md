# 系統架構：資料結構、關係與功能

一句話：**所有對外內容都必須能回溯到「經人工核定的原子命題」與其原始來源片段。**
AI 只負責拆解與草擬，核定權在使用者手上。整個資料結構都是為了讓這條回溯鏈不斷掉。

---

## 一、資料結構（19 張表，分五群）

每張表都有 `id`（uuid）、`owner_id`（→ `auth.users`）、`created_at`、`updated_at`，
並啟用 RLS，policy 一律是 `auth.uid() = owner_id`。以下只列各表的特徵欄位。

### 第 1 群：來源與原文（4 張）

| 表                | 用途             | 關鍵欄位                                                                                                         |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `profiles`        | 使用者設定       | `display_name`                                                                                                   |
| `sources`         | 一份來源文件     | `title`、`source_type`(text/file/url)、`origin_url`、`storage_path`、`content_hash`、`status`、`current_version` |
| `source_versions` | 每一次解析的結果 | `version`、`raw_text`、`content_hash`、`parser_version`、`chunk_count`、`is_current`                             |
| `document_chunks` | 切好的段落       | `paragraph_id`(P-001…)、`position`、`block_type`、`heading_path`、`text`、`char_start/end`、`content_hash`       |

**為什麼要分 source 與 source_version**：同一份文件重新抓取時不覆蓋舊版，
舊版保留、`is_current` 只有一筆。原子命題永遠指向它成立時的那一版。

### 第 2 群：處理與模型（3 張）

| 表                | 用途           | 關鍵欄位                                                                           |
| ----------------- | -------------- | ---------------------------------------------------------------------------------- |
| `processing_jobs` | 背景工作佇列   | `job_type`、`status`、`payload`、`result`、`attempts`、`scheduled_at`、`locked_by` |
| `prompt_versions` | 提示詞版本     | `name`、`version`、`template`、`checksum`                                          |
| `model_runs`      | 每一次模型呼叫 | `purpose`、`provider`、`model`、`input_tokens`、`output_tokens`、`latency_ms`      |

`processing_jobs` 兼作佇列：以 `FOR UPDATE SKIP LOCKED` 認領，
失敗以 30s／60s／120s 指數退避重試，最多 3 次。

### 第 3 群：候選原子命題與審核（3 張）

| 表                    | 用途                  | 關鍵欄位                                                                                                                                                                                                  |
| --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate_facts`     | AI 拆出的候選原子命題 | `statement`、`subject/predicate/object`、**`proposition_types`**、`conditions`、**`source_quote`**、**`source_paragraph_id`**、`risk_level`、`status`、`quality_flags`、`quality_score`、`statement_hash` |
| `review_records`      | 每一次審核動作        | `action`、`from_status`、`to_status`、`note`、`changes`                                                                                                                                                   |
| `extraction_feedback` | AI 抽錯的回報         | `feedback_type`、`description`、`statement_snapshot`、`quote_snapshot`、`paragraph_snapshot`                                                                                                              |

`proposition_types` 是**可複選**的九類分類（`proposition_type[]`）：
物質與物理化學性質、化學基本概念、事件、化學署主題、毒理與反應機制、
國內治理政策、國外治理政策、研究與期刊、醫學健康建議。
九類同時涵蓋知識內容、事件類型與治理層級，彼此本來就會重疊，因此不強迫單選；
空陣列代表未分類。「醫學健康建議」須為政府機關來源，否則會標記
`health_advice_source_not_gov` 並排除在批次核定之外。

`conditions` 是固定六個鍵的 jsonb：
`population`（族群）、`exposure_route`（暴露途徑）、`dose`（劑量）、
`duration`（持續時間）、`location`（地點）、`timeframe`（時間範圍）。

### 第 4 群：正式知識庫（5 張）

| 表                  | 用途                   | 關鍵欄位                                                                                                      |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `knowledge_facts`   | 核定後的正式原子命題   | 同候選原子命題 + `tags`、`status`(draft/active/inactive/superseded)、`version`、`supersedes`、`superseded_by` |
| `fact_versions`     | 原子命題的每一版快照   | `version`、`statement`、`change_note`                                                                         |
| `entities`          | 從主體／客體整理的實體 | `name`、`normalized_name`、`primary_type`、`fact_count`                                                       |
| `relations`         | 實體之間的關聯         | `subject_entity_id`、`object_entity_id`、`predicate`、`knowledge_fact_id`                                     |
| `embedding_records` | 向量索引               | `embedding`(vector)、`embedding_model`、`content_hash`、**`is_active`**                                       |

`embedding_records.is_active` 是增量更新的關鍵：原子命題改版時只停用該筆的舊向量、
只為新版產生一筆，永遠不重建整個索引。HNSW 索引帶 `where is_active` 的部分條件。

### 第 5 群：使用端（4 張）

| 表                     | 用途             | 關鍵欄位                                                                                                                        |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `answer_sessions`      | 一次問答         | `question`、`answer`、`insufficient_evidence`、`supported/partial/unsupported_count`、**`publishable`**、**`published_answer`** |
| `answer_evidence`      | 送進模型的證據包 | `knowledge_ref`(K-0001)、`knowledge_fact_id`、`combined_score`、`rank`                                                          |
| `answer_sentences`     | 回答的逐句判定   | `position`、`sentence`、**`verdict`**(supported/partial/unsupported)、`similarity`、`supporting_refs`                           |
| `communication_drafts` | 風險溝通素材     | `draft_type`(10 種)、`body`、`edited_body`、`audience`、`tone`、`knowledge_fact_ids`、`verification`、**`publishable`**         |

---

## 二、關係圖

### 主幹：可回溯性的鏈條

```text
auth.users
    │ owner_id（每一張表都有，RLS 以此隔離）
    ▼
sources ─────────┐
    │ 1:N        │ 1:N
    ▼            ▼
source_versions  processing_jobs
    │ 1:N
    ▼
document_chunks ─────────────┐
    │                        │ document_chunk_id
    │  source_version_id     ▼
    └──────────────► candidate_facts ◄──── prompt_versions
                          │  │  │               model_runs
                          │  │  └──────► review_records（審核歷程）
                          │  └─────────► extraction_feedback（模型品質回饋）
                          │
                          │ promote_candidate_fact()
                          ▼
                     knowledge_facts ──┬──► fact_versions（每一版快照）
                          │  │         ├──► embedding_records（向量，is_active）
                          │  │         └──► relations ──► entities
                          │  │
                          │  └─ supersedes / superseded_by（同一條原子命題的版本鏈）
                          │
                          ▼ 混合搜尋
                     answer_evidence ──► answer_sessions ──► answer_sentences
                                              │
                     communication_drafts ────┘（共用同一套逐句驗證）
```

### 一筆原子命題的完整回溯路徑

```text
正式原子命題 knowledge_facts
   ├─ source_quote ......... 支持這句話的原文片段
   ├─ source_paragraph_id .. P-004
   ├─ source_version_id .... 哪一版原文
   ├─ source_id ............ 哪一份文件（含 origin_url）
   └─ candidate_fact_id .... 它從哪一筆候選原子命題核定而來
          └─ review_records ... 誰在什麼時候、把什麼改成什麼、為什麼
```

任何一份對外素材 → `knowledge_fact_ids` → 上面這條鏈 → 原始網址與段落。
中間沒有任何一段是模型自己補的。

### 資料流：三條主要路徑

```text
【A】一般匯入（AI 抽取）
貼上文字／上傳檔案／輸入網址
  → sources + processing_jobs(parse_document)
  → Edge Function process-document：抓取／讀檔 → 清雜訊 → 切段落 → source_versions + document_chunks
  → processing_jobs(extract_facts)
  → Edge Function extract-facts：依 JSON Schema 抽取 → 自動品質檢查 → candidate_facts
  → 人工審核 → promote_candidate_fact() → knowledge_facts + entities + relations
  → processing_jobs(generate_embeddings) → embedding_records

【B】外部整理好的原子命題包（原文另外上傳）
原文（檔案／網址／文字）走 A 的解析步驟 → document_chunks
原子命題包 JSON（只要有 statement）
  → fact-matching：引句命中 → 敘述比對(≥0.55) → 段落編號 → 找不到就跳過
  → candidate_facts（系統定位的引句一律強制待審核）

【C】原子命題包自帶原文
原子命題包含 paragraph_text／document_chunks
  → article-pack 驗證與正規化（欄位別名、列舉值、部分匯入）
  → sources + source_versions + document_chunks + candidate_facts

【使用】
knowledge_facts → 混合搜尋（關鍵字 + 全文 + 三元組 + 向量）
  → 證據包 answer_evidence（K-0001…）
  → 模型作答／產製素材
  → 逐句驗證 answer_sentences / communication_drafts.verification
  → 紅色句子阻擋 → published_answer / 可否定稿
```

---

## 三、功能

### 頁面（17 個，對應工作單第 18 節）

| 路徑                      | 功能                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `/dashboard`              | 文件數、候選／核定原子命題數、待審核、高風險、驗證失敗句數、API 用量 |
| `/sources`                | 匯入（文字／檔案／網址）、清單、解析進度                             |
| `/sources/[id]`           | 版本、段落、重新解析、重新抽取                                       |
| `/import`                 | 原文 + 原子命題包、原子命題包單獨匯入、載入示範資料                  |
| `/review`                 | 候選原子命題清單、篩選、全選待審核、批次核定、回報抽取問題           |
| `/review/[id]`            | 單筆審核：修正、拆分、合併、前後文、相似原子命題、審核歷程           |
| `/knowledge`              | 正式原子命題清單、補齊向量                                           |
| `/knowledge/[id]`         | 版本歷程、修改（自動產生新版）、停用                                 |
| `/entities`               | 實體清單與原子命題數                                                 |
| `/relations`              | 實體關聯與支持它的原子命題                                           |
| `/search`                 | 混合搜尋，可依文件／類型／風險／實體篩選                             |
| `/ask`                    | AI 問答（只用核定原子命題）、證據包對照                              |
| `/verify`、`/verify/[id]` | 逐句綠黃紅判定、發布稿                                               |
| `/generate`               | 十種素材產製與清單                                                   |
| `/generate/[id]`          | 草稿逐句驗證、修改後重新驗證、定稿                                   |
| `/export`                 | JSON／CSV／Markdown 匯出、待選原子命題包與回填                       |
| `/history`                | 背景工作、審核、模型呼叫、抽取回報的時間線                           |
| `/settings/models`        | 目前模型設定與用量（只顯示金鑰有無，不顯示內容）                     |
| `/settings/prompts`       | 提示詞版本與抽取問題回報統計                                         |
| `/settings/account`       | 帳號、資料量、備份入口                                               |

### Edge Functions（4 個，Deno）

| 名稱                  | 職責                                                   |
| --------------------- | ------------------------------------------------------ |
| `process-document`    | 抓網頁／讀 Storage／PDF 文字抽取 → 切段落 → 建立版本   |
| `extract-facts`       | 依 JSON Schema 抽候選原子命題 → 自動品質檢查 → 寫入    |
| `generate-embeddings` | 只為缺向量的原子命題產生，寫入前停用該筆舊向量         |
| `scheduled-update`    | 找出過期的網址來源排入重新解析，並把卡住的工作放回佇列 |

### 資料庫函式（19 個，重要的幾個）

| 函式                        | 保證的事情                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `claim_processing_jobs`     | `FOR UPDATE SKIP LOCKED`，多 worker 不會搶到同一筆             |
| `fail_processing_job`       | 指數退避重試，超過上限才標記失敗                               |
| `requeue_stale_jobs`        | 逾時卡在 processing 的工作放回佇列                             |
| `promote_candidate_fact`    | **只有已核定、且有原文片段的候選原子命題才能變成正式原子命題** |
| `revise_knowledge_fact`     | 修改產生新版本、停用舊向量、只排一筆新向量工作                 |
| `search_knowledge_facts`    | 混合搜尋，只回現行原子命題                                     |
| `apply_answer_verification` | **只要有一句 unsupported，整份標為 blocked 且不產生發布稿**    |
| `upsert_entity`             | 正規化名稱後合併，累計 `fact_count`                            |
| `prompt_feedback_stats`     | 各版提示詞的回報統計                                           |

### 共用模組（`supabase/functions/_shared/`）

同一份 TypeScript 在 Deno（Edge Function）、Vitest（測試）、Next.js（Server Action）
三個執行環境跑，只用 Web 標準 API，避免兩套實作長期漂移。

| 模組                             | 內容                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `parse.ts`／`html.ts`／`text.ts` | 清雜訊、切段落、編號 P-001、字元位置                  |
| `diff.ts`                        | 版本比對：added／changed／removed                     |
| `extraction.ts`                  | 抽取提示詞與 JSON Schema                              |
| `quality.ts`                     | 自動品質檢查（缺引句、數字不符、條件遺失、語氣放大…） |
| `answering.ts`                   | 證據包、作答提示詞、引用解析、拆句                    |
| `verification.ts`                | 逐句驗證（確定性規則，不再呼叫模型）                  |
| `generation.ts`                  | 十種素材規格、體裁結構辨識、素材專用逐句驗證          |
| `article-pack.ts`                | 文章包驗證與正規化（寬進嚴審）                        |
| `fact-matching.ts`               | 原子命題 ↔ 段落比對與引句定位                         |
| `pack.ts`                        | 待選原子命題包（欄位說明 + 三項校正目標 + 回填格式）  |
| `llm/*`                          | Mock／OpenAI／Anthropic provider 與 embeddings        |

---

## 四、四條不可繞過的規則

這些規則寫在資料庫或共用模組裡，任何一條呼叫路徑都繞不過去。

1. **沒有原文片段的原子命題不得成為正式知識**
   `promote_candidate_fact` 直接 raise exception。

2. **只有人工核定的候選原子命題能變成正式原子命題**
   AI 抽取、外部 LLM 校正回填、文章包匯入——三條路徑的產出一律是待審核。

3. **只要有一句沒有原子命題支持，整份回答就阻擋**
   `apply_answer_verification` 在資料庫層把 `published_answer` 設為 null，
   不是只靠前端隱藏。素材的定稿按鈕同理，Server Action 會再檢查一次。

4. **向量永遠增量更新**
   沒有任何一處會刪除全部向量重建；單元測試會檢查 migration 裡沒有
   `delete from embedding_records;` 或 `truncate`。

以及一條資料隔離規則：**每張表都有 `owner_id` 且啟用 RLS**，
不得以關閉 RLS 解決權限問題——單元測試會掃描 migration 是否出現
`disable row level security`。

---

## 五、規模

```text
19 張資料表    19 個資料庫函式    14 個列舉型別
4  個 Edge Function                17 個頁面
11 個共用模組                      342 項單元測試
```
