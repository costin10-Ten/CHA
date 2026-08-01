# 個人知識庫與風險溝通產製系統

以「經人工核定的事實」為基礎的個人知識庫。AI 只負責拆解與草擬，核定權在使用者手上；
所有對外內容都必須能回溯到核定事實與其原始來源片段。

## 架構

```text
GitHub
  ↓
Vercel
  ├─ Next.js App Router（前端）
  ├─ Server Actions
  └─ Route Handlers
        ↓
Supabase
  ├─ Auth
  ├─ PostgreSQL
  ├─ pgvector
  ├─ Storage
  ├─ Row Level Security
  ├─ Edge Functions
  ├─ Queues
  └─ Cron
        ↓
OpenAI／Anthropic 等模型 API（測試一律使用 Mock Provider）
```

## 技術棧

| 層   | 內容                                                                             |
| ---- | -------------------------------------------------------------------------------- |
| 前端 | Next.js 15 App Router、TypeScript strict、Tailwind CSS 4、React Hook Form、Zod   |
| 後端 | Supabase Auth / PostgreSQL / Storage / pgvector / Edge Functions / Queues / Cron |
| 品質 | ESLint、Prettier、Vitest、Playwright、GitHub Actions                             |
| 模型 | OpenAI 相容 API、Anthropic API、Mock Provider（可切換 Embedding 模型）           |

## 目前進度

| Phase | 內容                                                                | 狀態    |
| ----- | ------------------------------------------------------------------- | ------- |
| 1     | Next.js 專案、Supabase 結構、Auth、profiles、RLS、CI、首頁與登入頁  | ✅ 完成 |
| 2     | 文字／檔案／網址匯入、Storage 直傳、processing_jobs、文件解析與版本 | ✅ 完成 |
| 3     | Edge Function 抽取候選事實、Mock Provider、JSON Schema、品質檢查    | ✅ 完成 |
| 4     | 單人審核介面（核定、修正、駁回、拆分、合併）、review_records        | ✅ 完成 |
| 5     | 正式事實庫、實體與關聯、版本管理、pgvector 增量索引                 | ✅ 完成 |
| 6     | 混合搜尋、證據包、AI 問答、引用來源                                 | ✅ 完成 |
| 7     | 逐句驗證、綠黃紅標示、紅色句子阻擋                                  | ✅ 完成 |
| 8     | 風險溝通素材、匯出與備份、增量更新與排程                            | ✅ 完成 |
| 9     | UI 整理、完整頁面、示範資料、部署文件、Production 驗證              | ✅ 完成 |

## 本機開發

### 1. 安裝

```bash
npm ci
```

### 2. 設定環境變數

```bash
cp .env.example .env.local
```

填入 Supabase 專案的 URL 與金鑰。前端只會使用：

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

`SUPABASE_SECRET_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 僅限伺服器端，
不可加上 `NEXT_PUBLIC_` 前綴，也不可提交進 Git（`.env*` 已被忽略，僅 `.env.example` 例外）。

### 3. 建立資料庫

使用 [Supabase CLI](https://supabase.com/docs/guides/cli)：

```bash
# 本機完整堆疊（含 Auth、Storage、Studio）
supabase start
supabase db reset          # 套用 migrations 與 seed.sql

# 或推送到雲端專案
supabase link --project-ref <your-project-ref>
npm run db:push
```

`supabase/seed.sql` 會建立本機測試帳號 `dev@example.com` / `devpassword123`
（僅存在於本機 `supabase start` 的資料庫）。

### 4. 啟動

```bash
npm run dev
```

開啟 http://localhost:3000 ，於 `/login` 註冊或登入後進入 `/dashboard`。

## 指令

| 指令                                      | 說明                                  |
| ----------------------------------------- | ------------------------------------- |
| `npm run dev`                             | 開發伺服器                            |
| `npm run build` / `npm start`             | 正式建置與啟動                        |
| `npm run lint` / `npm run lint:fix`       | ESLint                                |
| `npm run format` / `npm run format:check` | Prettier                              |
| `npm run typecheck`                       | TypeScript strict 檢查                |
| `npm test`                                | Vitest 單元測試（不呼叫任何付費 API） |
| `npm run test:e2e`                        | Playwright smoke test                 |
| `npm run db:push` / `npm run db:reset`    | Supabase migrations                   |
| `npm run functions:deploy`                | 部署 Supabase Edge Functions          |

執行 E2E 時若環境已預裝 Chromium，可用
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e` 指定執行檔；
否則先執行 `npx playwright install chromium`。

## 專案結構

```text
app/                Next.js App Router 頁面與 Route Handlers
  auth/callback/    Supabase Email／Magic Link 導回處理
  dashboard/        登入後首頁
  login/            登入頁與 Server Actions
  sources/          來源匯入、清單、詳情與 Server Actions
  review/           候選事實審核與抽取問題回報
  knowledge/        正式事實與版本
  search/ ask/      混合搜尋與 AI 問答
  verify/           逐句驗證
  generate/         風險溝通素材產製與草稿
  export/           匯出頁與待選事實包回填
  import/           文章包匯入與示範資料
  history/          背景工作、審核、模型呼叫與回報的時間線
  settings/         模型與用量、提示詞與回報、帳號與資料
  api/export/       匯出下載（JSON／CSV／Markdown）
components/
  ui/               基礎 UI 元件
  auth/             登入與登出
  sources/          匯入表單、工作進度、來源操作
  review/           審核清單、單筆編輯、回報抽取問題
  generate/         素材表單與草稿編輯
  export/           待選事實包回填
  import/           文章包匯入與示範資料載入
  settings/         子導覽與回報處理狀態
lib/
  auth/             登入表單 schema 與錯誤訊息
  jobs/             工作狀態標籤與觸發 Edge Function
  sources/          匯入驗證 schema 與資料查詢
  facts/            候選事實查詢、審核規則與標籤
  knowledge/        正式事實、實體、關聯查詢
  retrieval/        混合搜尋
  answering/        問答紀錄查詢
  generate/         素材查詢與標籤
  export/           匯出格式（純函式，可單元測試）與查詢
  settings/         提示詞、回報與模型用量查詢
  dashboard/        Dashboard 統計與 API 用量
  history/          處理歷程時間線
  demo/             示範資料（自行撰寫，走一般匯入路徑）
  supabase/         browser／server／admin client 與 middleware
  env.ts            環境變數集中驗證
  profile.ts        profiles 讀寫
supabase/
  migrations/       資料庫結構與 RLS policy（全部納入版控）
  functions/
    _shared/        解析、抽取、問答、驗證、產製與匯出包
                    （純 TypeScript，Deno 與 Vitest 共用同一份程式碼）
    process-document/    文件解析 worker
    extract-facts/       候選事實抽取 worker
    generate-embeddings/ 向量產生 worker
    scheduled-update/    排程更新 worker
  seed.sql          本機示範資料
  config.toml       Supabase CLI 設定
docs/
  ARTICLE-PACK.md   文章包匯入格式
  BACKUP.md         備份與還原操作
  DEPLOY.md         部署設定與上線檢查清單
  BACKLOG.md        使用者提出的需求追蹤
tests/
  unit/             Vitest
  e2e/              Playwright
.github/workflows/  CI 與 Supabase migration／Edge Function 部署
```

## 匯入與處理流程

```text
瀏覽器
  ├─ 貼入文字 → Server Action 建立 source 並保存原文到 Storage
  ├─ 上傳檔案 → Server Action 只發 signed upload URL，檔案由瀏覽器直傳 Storage
  └─ 輸入網址 → Server Action 建立 source（抓取交給 worker）
        ↓
processing_jobs 建立一筆 parse_document 工作
        ↓
Edge Function process-document
  claim_processing_jobs（FOR UPDATE SKIP LOCKED）
  → 讀 Storage／抓網頁 → 清除導覽列與廣告 → 切段落並編號 P-001…
  → 內容雜湊未變則不建立新版本
  → 建立 source_versions（舊版自動失去 is_current）與 document_chunks
  → complete／fail（失敗以 30s、60s、120s 指數退避重試，最多 3 次）
        ↓
前端輪詢 processing_jobs 顯示進度
```

檔案內容從不經過應用伺服器；重的解析工作也不在使用者的請求中執行。

### Storage 路徑

```text
sources/{owner_id}/{source_id}/original.<ext>     上傳或貼入的原始內容
sources/{owner_id}/{source_id}/raw.html           網址來源抓取到的原始 HTML
sources/{owner_id}/{source_id}/parsed-v{n}.json   每一版的解析結果
```

Storage RLS 以路徑第一層（owner_id）判斷，使用者只能存取自己的資料夾。

### 背景工作排程

Edge Function 有兩種觸發方式：

1. 前端匯入完成後以使用者 JWT 呼叫，立即處理該使用者的工作
2. Supabase Cron 定期呼叫，負責重試與排程更新

排程需在 Supabase SQL Editor 執行一次（把網址與密鑰換成你的值）：

```sql
select cron.schedule(
  'process-documents',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<your-ref>.supabase.co/functions/v1/process-document',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', '<你的 CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Edge Function 需要 `CRON_SECRET`（`supabase secrets set CRON_SECRET=...`，或在
Dashboard → Edge Functions → Secrets 設定）。未設定排程也能運作，只是失敗的工作
不會自動重試。

## 候選事實抽取

文件解析完成後會自動排入 `extract_facts` 工作，由 Edge Function `extract-facts` 處理：

```text
現行版本的段落（每次 6 段）
  → 依 §8.2 的 JSON Schema 要求模型輸出
  → 解析回應（容錯：去除程式碼區塊、丟棄缺欄位的項目）
  → 自動品質檢查
  → 寫入 candidate_facts（含品質標記與分數）
  → 記錄 model_runs 用量與 prompt_versions 版本
```

### 自動品質檢查

| 檢查                       | 標記                         | 處置                   |
| -------------------------- | ---------------------------- | ---------------------- |
| 沒有原文片段               | `missing_quote`              | 直接丟棄，不進核定流程 |
| 片段不存在於原文           | `quote_not_in_source`        | 直接丟棄               |
| 數字或單位與原文不符       | `number_mismatch`            | 標記待審               |
| 以指代詞開頭（主詞不完整） | `incomplete_subject`         | 標記待審               |
| 一句包含多個命題           | `multi_proposition`          | 標記待審               |
| 條件或限制遺失             | `condition_lost`             | 標記待審               |
| 可能性被改寫成確定語氣     | `certainty_escalated`        | 標記待審               |
| 疑似推論而非原文陳述       | `inference_suspected`        | 標記待審               |
| 疑似重複／疑似矛盾         | `duplicate`／`contradiction` | 標記待審               |

品質分數由標記扣分而來，`/review` 可依來源、狀態、風險等級、知識類型與標記篩選。

### 模型設定

Edge Function 讀取這些 secrets（Dashboard → Edge Functions → Secrets 或
`supabase secrets set`）：

```env
LLM_PROVIDER=mock        # mock | openai | anthropic
LLM_MODEL=               # 留空使用各 provider 預設值
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LLM_BASE_URL=            # 指向 OpenAI 相容服務時才需要
```

未設定時使用 Mock Provider：不呼叫任何外部 API，把段落逐句轉成候選事實，
可完整跑過抽取、品質檢查與審核流程。單元測試與 CI 一律走這條路徑。

## 單人審核

`/review` 是候選事實清單（可篩選、可勾選批次操作），`/review/[id]` 是單筆審核畫面。

| 操作         | 行為                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| 核定         | 狀態改為已核定                                                                                 |
| 修正後核定   | 修改敘述、主體、條件、風險等級後核定；**會用同一套自動品質檢查重新評分**，手動修改不會繞過檢查 |
| 駁回         | 狀態改為已駁回                                                                                 |
| 標記待確認   | 狀態改為待修正                                                                                 |
| 拆成多筆     | 一行一筆建立多筆待審核事實，原事實標記為已拆分並保留                                           |
| 合併         | 勾選兩筆以上合併成一筆新的待審核事實，原事實標記為已合併                                       |
| 重新抽取本段 | 只針對該段落重新排入抽取工作                                                                   |
| 退回待審核   | 把已核定／已駁回／已合併／已拆分的事實退回 pending                                             |

批次功能：批次核定、批次駁回、批次標記待確認，以及「選取可批次核定的 N 筆」
（條件為待審核 + 低風險 + 無品質標記）。

單筆審核畫面同時顯示：可編輯的事實欄位、原文片段、**前後文段落**、文件標題與網址、
條件欄位、風險等級、**以三元組相似度找出的相似既有事實**，以及完整審核歷程。

每一個動作都會寫入 `review_records`：動作類型、前後狀態、變更欄位的 from/to、
備註與關聯 ID，審核歷程完全可追溯。

## 正式事實與版本

候選事實核定後會立即寫入 `knowledge_facts`，並同時完成三件事：
建立 `fact_versions` 快照、整理主體與客體成 `entities` 與 `relations`、
排入只針對這一筆的向量工作。

```text
核定候選事實
  → promote_candidate_fact（拒絕沒有原文片段或未核定的事實）
  → knowledge_facts（status=active, version=1）
  → fact_versions 快照 + entities/relations
  → processing_jobs（generate_embeddings，payload 只帶這一筆的 id）
```

修改正式事實時：

```text
revise_knowledge_fact
  → 舊版 status=superseded、superseded_by 指向新版
  → 新版 version+1、supersedes 指向舊版
  → 只把「這一筆」的舊向量 is_active=false
  → 只為新版排入一筆向量工作
```

舊版本永遠保留、可查閱，但不會出現在搜尋結果中（向量索引是
`where is_active` 的部分索引）。停用事實時其向量一併退出搜尋。
`tests/unit/knowledge-migration.test.ts` 會檢查這些規則沒有被改壞，
包括「沒有任何一次性刪除全部向量的語句」。

### 向量

| 項目     | 值                                                                       |
| -------- | ------------------------------------------------------------------------ |
| 維度     | 1536（與 `embedding_records.embedding` 欄位一致）                        |
| 索引     | HNSW + cosine，只涵蓋 `is_active` 的向量                                 |
| Provider | `EMBEDDING_PROVIDER`（預設跟隨 `LLM_PROVIDER`）：mock 或 openai          |
| 每筆保存 | knowledge_fact_id、fact_version、model、version、content_hash、is_active |

Mock embedding 以字元 bigram 雜湊產生確定性向量：不具語意，但同樣文字得到
同樣向量、用字重疊的句子相似度較高，足以在不呼叫付費 API 的情況下驗證
索引與增量更新。

## 混合搜尋與 AI 問答

### 混合搜尋（`/search`）

`search_knowledge_facts` 在一次查詢中並用四種比對：

| 訊號                | 用途                                                   |
| ------------------- | ------------------------------------------------------ |
| ILIKE 子字串        | 中文在 `simple` 設定下不會斷詞，這是最可靠的關鍵字命中 |
| PostgreSQL 全文搜尋 | `ts_rank_cd` + `plainto_tsquery`，對英文與數字有效     |
| 三元組相似度        | `pg_trgm`，容忍錯字與部分詞                            |
| 向量相似度          | pgvector cosine，只比對 `is_active` 的現行向量         |

總分為關鍵字與向量各半（沒有向量時只用關鍵字）。可依文件、知識類型、
風險等級與實體篩選，也能切換成純關鍵字模式。查詢向量在伺服器端產生，
預設用 mock，不需要金鑰。

**所有查詢都在資料庫函式內強制 `owner_id = auth.uid()` 與 `status = 'active'`**，
被取代與停用的版本永遠不會出現在結果中。

### AI 問答（`/ask`）

```text
問題
  → 混合搜尋取出最多 8 筆現行核定事實
  → 組成證據包（knowledge_id、statement、conditions、
     source_title、source_url、source_locator、version）
  → 送模型（只有證據包，看不到未核定內容）
  → 保存 answer_sessions、answer_evidence 快照與拆句結果
```

保護機制：

- 檢索不到任何核定事實時**直接回覆資料不足，完全不呼叫模型**
- 回答若引用證據包以外的知識編號，會記錄為警告（幻覺訊號）
- 證據以快照保存，事實日後被修改仍看得到當時用了什麼版本
- 提示詞明文禁止使用模型自身知識、要求保留條件與不確定性、要求標註 `[K-0001]`

Mock Provider 在問答模式下只會引用證據包中的事實並附上知識編號，
因此整條鏈路（檢索 → 證據包 → 作答 → 引用檢查）都能在不花錢的情況下驗證。

## 逐句驗證與發布阻擋

回答產生後**立即自動執行**逐句驗證（`/verify`、`/verify/[id]` 可重新驗證）。

判定刻意做成確定性規則，不再呼叫模型：結果可重現、可完整單元測試，
也不會因為模型當天輸出不同而放行不該放行的句子。

| 判定              | 條件                                                       | 處置                     |
| ----------------- | ---------------------------------------------------------- | ------------------------ |
| 🟢 綠 supported   | 與核定事實覆蓋率 ≥ 0.55，數字、否定、條件、語氣全部一致    | 可進入發布稿             |
| 🟡 黃 partial     | 有事實支持但語氣被放大、適用條件未保留，或覆蓋率不足       | 保留在發布稿，需人工確認 |
| 🔴 紅 unsupported | 找不到支持事實、數字對不上、否定相反、引用不存在的知識編號 | **不得進入發布稿**       |

紅色的具體判定條件：

- 與所有事實的覆蓋率都低於 0.25
- 句中數字或單位在支持事實中找不到
- 否定與肯定和事實相反（「會累積」vs「不會累積」）
- 引用了證據包以外的知識編號（幻覺訊號）

**只要有一句紅色，整份回答就標為 blocked，`published_answer` 不會產生**——
這條規則寫在資料庫函式 `apply_answer_verification` 裡，不是只靠前端隱藏。

條件比對是逐詞比對而非「有沒有條件詞」：事實寫「孕婦」、回答只寫「每週」
仍會被標記為條件未保留。

## 風險溝通素材產製

`/generate` 用核定事實產製十種素材：FAQ、科普短文、長篇文章、Podcast 訪綱、
Podcast 逐字稿、60 秒短影音腳本、3 分鐘短影音腳本、圖卡文字架構、媒體問答、社群貼文。

```text
主題 → 混合搜尋取出核定事實 → 證據包 → 依體裁撰稿
     → 立即逐句驗證 → 有紅色句子就標記為 blocked
```

每份素材保存工作單第 15 節要求的全部欄位：使用的知識 ID 與知識編號、
目標受眾、語氣、模型、提示詞版本、生成日期、驗證結果，以及使用者修改後的版本
（`edited_body`，原始產出保留在 `body` 供比對）。

**所有產出預設為草稿**。定稿按鈕在 `publishable = false` 時不可按，
`finalizeDraft` 也會再檢查一次，不是只靠前端隱藏。

### 素材的逐句驗證與問答有何不同

素材有體裁結構：小標、題號、秒數、「旁白：」這類文字不是事實主張，
拿去比對核定事實一定找不到支持，會讓每一份草稿都被誤判為阻擋。

因此 `verifyDraftBody` 會先辨識體裁結構並標記為 `structural`，不計入綠黃紅統計。
判定結構的條件刻意只認**明確可辨識**的形式（Markdown 標題記號、章節名、
純標籤、第一行的標題），**不用長度判斷**——圖卡文字這類體裁的內容本來就很短，
用長度會讓真正的短句事實主張被當成結構而略過驗證。

## 匯出與備份

`/export` 提供工作單第 17 節要求的全部匯出：

| 內容             | 格式                | 說明                                |
| ---------------- | ------------------- | ----------------------------------- |
| 正式事實         | JSON／CSV／Markdown | 只含現行版本，每筆附原文片段與段落  |
| 事實與來源對照表 | JSON／CSV／Markdown | 稽核用：事實 ↔ 文件 ↔ 段落 ↔ 原文句 |
| 單篇文件與其事實 | JSON／Markdown／CSV | 含該版全部段落                      |
| 待選事實包       | JSON                | 給其他 LLM 校正（見下節）           |

匯出走 Route Handler `/api/export`，以使用者 session 查詢，RLS 保證只匯得到自己的資料。
格式轉換寫在 `lib/export/serialize.ts`，是不碰資料庫的純函式，完整單元測試。

資料庫備份、Storage 檔案備份與還原步驟見 [`docs/BACKUP.md`](docs/BACKUP.md)。

### 待選事實包與回填

匯出包自帶說明，讓沒有本專案脈絡的模型也能正確處理：

- **欄位說明**：每個欄位的意義、允許值、可否修改。
  `source_quote`、`source_paragraph_id`、`id` 等來源欄位標記為不可修改
- **校正目標**：不聳動、部會權責正確、科學正確性，各附具體檢查項目
  （例如食品標示屬衛福部食藥署、農藥殘留屬農業部、排放屬環境部；
  數值單位不得改動；相關性不得寫成因果）
- **回填格式**：範例 JSON 與規則

回填時的檢查：

```text
貼上／上傳 JSON → 解析與格式驗證 → 以 id 比對回原本的候選事實
  → 檢查不可修改欄位有沒有被動過（動過就整筆拒絕）
  → 重新執行 checkFactQuality（原文找不到依據就拒絕）
  → 寫回候選事實，狀態維持「待審核」
  → 寫一筆 external_correction 審核紀錄
```

**回填永遠不會直接核定**，仍然要人工逐筆確認。

## 匯入外部整理好的文章

在對話或其他工具中整理好的一篇文章，可以連同段落、候選事實、審核紀錄與正式事實
一次匯入（`/import`）。格式與驗證規則見 [`docs/ARTICLE-PACK.md`](docs/ARTICLE-PACK.md)。

匯入前一定先驗證，沒通過就不寫入任何一筆。最重要的一條規則：

> 檔案必須自帶原文。`document_chunks[].text` 與 `candidate_facts[].source_quote`
> 不能是佔位符，而且引句必須真的出現在該段落的文字中。

匯入端無法從網址自動還原「是原文的哪一段、哪一句」——網頁改版、段落編號規則不同
都會對不上，猜錯就等於偽造引用。指向資料庫產生值的綁定佔位符
（`$auth.uid()`、`$candidate_facts[C001].id` 等）則會在匯入時解析。

正式事實一律由候選事實經 `promote_candidate_fact` 產生；預設全部以「待審核」匯入，
要沿用檔案中的人工核定結果必須明確勾選。

## 抽取問題回報

審核時除了駁回，還可以按「回報抽取問題」記錄 AI 錯在哪裡，用來改進提示詞。
記錄內容包含當時的 `prompt_version_id`、`model_run_id`，以及敘述、原文片段、
段落全文的快照——候選事實日後被修改也看得到問題現場。

`/settings/prompts` 顯示每一版提示詞的回報數、未處理數與最常見的問題類型。
這與 `review_records` 分開：那是審核歷程，這是模型品質回饋。

## 增量更新與排程

重新匯入或排程重抓時（工作單第 16 節）：

```text
重新抓取 → 計算內容雜湊
  雜湊相同 → 不建立新版本，也不重抽事實
  雜湊不同 → 建立新版本 → diffVersions 找出 added／changed／removed
           → 只為 added 與 changed 的段落排入抽取
           → 未變動段落的既有事實與向量完全不動
```

第一次解析才會全文抽取；之後一律只處理受影響段落。

Edge Function `scheduled-update` 負責決定哪些來源該重新檢查：

- Cron 以 `x-cron-secret` 呼叫 → 檢查所有使用者的網址來源
- 使用者以 JWT 呼叫 → 只檢查自己的來源

它本身不抓網頁也不呼叫模型，只呼叫 `enqueue_scheduled_updates` 排入
`parse_document` 工作，並順手把卡住的工作放回佇列。

```sql
select cron.schedule(
  'scheduled-update',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://<your-ref>.supabase.co/functions/v1/scheduled-update',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', '<你的 CRON_SECRET>'
    ),
    body := '{"max_age_hours": 168}'::jsonb
  );
  $$
);
```

## 資料權限

即使只有單一使用者，仍實作完整 Auth 與 RLS：

- 每張主要資料表都有 `owner_id uuid references auth.users(id)`
- 每張表 `enable row level security`，policy 以 `auth.uid() = owner_id` 判斷
- 新使用者註冊時由 `handle_new_user` trigger 自動建立 profile
- 任何情況都不得以關閉 RLS 解決權限錯誤（單元測試會檢查 migration 是否出現 `disable row level security`）

## 示範資料

`/import` 的「載入示範資料」會匯入三篇自行撰寫的短文（氫氟酸、汞、蘇丹紅），
每篇 12 筆候選事實（6 核定、2 待修正、2 駁回、2 待審核）與 3 份素材草稿。

被駁回的兩筆刻意做成真實會發生的抽取錯誤——把「部分」寫成「都」、
把第 3 類分類寫成「吃到就會得癌症」——用來檢查審核與驗證規則有沒有在運作。

示範資料走的是與一般匯入完全相同的驗證與匯入路徑，不是特例插入。

## 部署

### Vercel

1. 於 Vercel 匯入本 GitHub repo
2. Framework 選 Next.js（`vercel.json` 已指定 build 與 install 指令）
3. 在 Project Settings → Environment Variables 依 `.env.example` 設定
   Production 與 Preview 兩組變數
4. `main` 分支部署 Production，其他分支的 Pull Request 自動建立 Preview Deployment

### Supabase

1. 建立專案並取得 URL、publishable key、secret key
2. `supabase link --project-ref <ref>` 後執行 `npm run db:push`
3. Authentication → URL Configuration 加入
   `https://<你的網域>/auth/callback` 與 Preview 網域
4. 後續 Phase 的 Edge Functions 以 `npm run functions:deploy` 部署

### 不安裝任何工具的純網頁流程

不想在本機 clone repo 或安裝 CLI 時，migration 可由 GitHub Actions 代為套用
（`.github/workflows/db-migrate.yml`）。在 GitHub → Settings →
Secrets and variables → Actions 建立三個 Repository Secret：

| Secret                  | 取得位置                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → Generate new token                                |
| `SUPABASE_PROJECT_ID`   | 專案 ref，即 `https://<ref>.supabase.co` 的 `<ref>`                                               |
| `SUPABASE_DB_PASSWORD`  | 建立專案時設定的資料庫密碼（忘記可在 Project Settings → Database → Reset database password 重設） |

設定後，只要 `supabase/migrations/` 有變動並推上分支就會自動套用；
也可在 Actions → Supabase Migrations → Run workflow 手動執行。

首次套用（workflow 尚未進入 main 之前）可改用 Supabase Dashboard →
SQL Editor → New query，貼上 `supabase/migrations/` 內的 SQL 執行，效果相同。

詳細的環境變數、Cron 設定與上線檢查清單見
[`docs/DEPLOY.md`](docs/DEPLOY.md)。

## 分支

```text
main        Production
develop     整合
feature/*   功能
fix/*       修正
```

## CI

- `.github/workflows/ci.yml`：push 與 PR 時執行 `npm ci` → lint → format check →
  typecheck → unit tests → build → Playwright smoke test。使用 placeholder
  Supabase 變數與 `LLM_PROVIDER=mock`，不會呼叫付費 API。
- `.github/workflows/db-migrate.yml`：`supabase/migrations/` 或
  `supabase/functions/` 有變動時，自動執行 `supabase db push` 與
  `supabase functions deploy`。

## 設計取捨

- **佇列**：`processing_jobs` 資料表搭配 `claim_processing_jobs`
  （`FOR UPDATE SKIP LOCKED`）作為佇列。工作狀態、重試次數、錯誤與模型用量都是
  查得到的資料列，前端可直接輪詢；要改用 Supabase Queues 時只需替換派工方式，
  資料模型不變。
- **解析程式碼**：`supabase/functions/_shared/` 只使用 Web 標準 API，
  Deno（Edge Function）與 Vitest（單元測試）執行的是同一份檔案，
  避免兩套實作長期漂移。PDF 文字抽取需要 npm 套件，因此留在 Edge Function 內。
