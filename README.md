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
| 2     | 文字／檔案／網址匯入、Storage 直傳、processing_jobs、文件解析與版本 | ⏳ 待辦 |
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
components/         UI 元件（ui/ 為基礎元件，auth/ 為登入相關）
lib/
  auth/             登入表單 schema 與錯誤訊息
  supabase/         browser／server／admin client 與 middleware
  env.ts            環境變數集中驗證
  profile.ts        profiles 讀寫
supabase/
  migrations/       資料庫結構與 RLS policy（全部納入版控）
  seed.sql          本機示範資料
  config.toml       Supabase CLI 設定
tests/
  unit/             Vitest
  e2e/              Playwright
.github/workflows/  CI
```

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

## 分支

```text
main        Production
develop     整合
feature/*   功能
fix/*       修正
```

## CI

GitHub Actions（`.github/workflows/ci.yml`）在 push 與 PR 時執行：
`npm ci` → lint → format check → typecheck → unit tests → build → Playwright smoke test。
CI 使用 placeholder Supabase 變數與 `LLM_PROVIDER=mock`，不會呼叫付費 API。
