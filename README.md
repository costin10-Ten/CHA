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
| 3     | Edge Function 抽取候選事實、Mock Provider、JSON Schema、品質檢查    | ⏳ 待辦 |
| 4     | 單人審核介面（核定、修正、駁回、拆分、合併）、review_records        | ⏳ 待辦 |
| 5     | 正式事實庫、實體與關聯、版本管理、pgvector 增量索引                 | ⏳ 待辦 |
| 6     | 混合搜尋、證據包、AI 問答、引用來源                                 | ⏳ 待辦 |
| 7     | 逐句驗證、綠黃紅標示、紅色句子阻擋                                  | ⏳ 待辦 |
| 8     | 風險溝通素材、匯出與備份、更新與排程                                | ⏳ 待辦 |
| 9     | UI 整理、效能、完整測試、部署文件、Production 驗證                  | ⏳ 待辦 |

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
components/
  ui/               基礎 UI 元件
  auth/             登入與登出
  sources/          匯入表單、工作進度、來源操作
lib/
  auth/             登入表單 schema 與錯誤訊息
  jobs/             工作狀態標籤與觸發 Edge Function
  sources/          匯入驗證 schema 與資料查詢
  supabase/         browser／server／admin client 與 middleware
  env.ts            環境變數集中驗證
  profile.ts        profiles 讀寫
supabase/
  migrations/       資料庫結構與 RLS policy（全部納入版控）
  functions/
    _shared/        解析管線（純 TypeScript，Deno 與 Vitest 共用同一份程式碼）
    process-document/  文件解析 worker
  seed.sql          本機示範資料
  config.toml       Supabase CLI 設定
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

## 資料權限

即使只有單一使用者，仍實作完整 Auth 與 RLS：

- 每張主要資料表都有 `owner_id uuid references auth.users(id)`
- 每張表 `enable row level security`，policy 以 `auth.uid() = owner_id` 判斷
- 新使用者註冊時由 `handle_new_user` trigger 自動建立 profile
- 任何情況都不得以關閉 RLS 解決權限錯誤（單元測試會檢查 migration 是否出現 `disable row level security`）

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
