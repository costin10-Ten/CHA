# 部署與上線檢查

全程可在瀏覽器完成，不需要在本機安裝任何工具。

---

## 1. 三個服務的關係

```text
GitHub（程式碼、migration、Edge Function）
  ├─ push → Vercel 建置並部署前端與 Server Actions
  └─ push → GitHub Actions 執行 supabase db push 與 functions deploy
                                      ↓
                                  Supabase（資料庫、Auth、Storage、Edge Functions）
```

程式碼是唯一的真實來源：資料庫結構、RLS policy 與 Edge Function 全部在
`supabase/` 目錄裡，推上去就會套用。不要在 Dashboard 手動改結構，
否則下一次 `db push` 會出現落差。

---

## 2. GitHub Secrets

Settings → Secrets and variables → Actions：

| Secret                  | 用途           | 從哪裡取得                                  |
| ----------------------- | -------------- | ------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | CLI 登入       | Supabase → Account → Access Tokens          |
| `SUPABASE_PROJECT_REF`  | 指定專案       | 專案網址 `https://<ref>.supabase.co` 的 ref |
| `SUPABASE_DB_PASSWORD`  | `db push` 連線 | 建立專案時設定的資料庫密碼                  |

缺任何一個，`Supabase Migrations` workflow 會直接失敗並列出缺少的名稱。

---

## 3. Vercel 環境變數

Settings → Environment Variables。**每一個變數的 Environments 都要同時勾選
Production、Preview、Development**，否則 Preview 部署會讀不到值，
需要登入的頁面會直接失敗。

| 變數                                   | 範圍     | 說明                                   |
| -------------------------------------- | -------- | -------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | 前端可見 | 專案網址                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 前端可見 | publishable／anon key                  |
| `SUPABASE_SECRET_KEY`                  | 僅伺服器 | service key，**絕不可加 NEXT_PUBLIC_** |
| `LLM_PROVIDER`                         | 僅伺服器 | `mock`／`openai`／`anthropic`          |
| `LLM_MODEL`、`EMBEDDING_MODEL`         | 僅伺服器 | 不填則用 provider 預設                 |
| `OPENAI_API_KEY`／`ANTHROPIC_API_KEY`  | 僅伺服器 | 依 provider 需要                       |
| `APP_URL`                              | 僅伺服器 | Auth 導回用，例如 `https://你的網域`   |
| `CRON_SECRET`                          | 僅伺服器 | 與 Supabase Edge Function 的密鑰一致   |

改完環境變數要**重新部署**才會生效（Deployments → 該筆 → Redeploy）。

金鑰只存在於伺服器端。`/settings/models` 只顯示「有沒有設定」，不顯示內容。

---

## 4. Supabase 設定

### 4.1 Auth

Authentication → Providers → Email：

- 開發階段可關閉 Confirm email，正式上線建議開啟
- Authentication → URL Configuration → Site URL 填 Production 網址
- Redirect URLs 加入 `https://你的網域/auth/callback`
  與 Preview 網域（`https://*.vercel.app/auth/callback`）

### 4.2 Edge Function Secrets

Edge Functions → Secrets（或 `supabase secrets set`）：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY   （或 SUPABASE_SECRET_KEY）
CRON_SECRET
LLM_PROVIDER / OPENAI_API_KEY / ANTHROPIC_API_KEY / EMBEDDING_MODEL
```

### 4.3 Cron

在 SQL Editor 執行一次（換成你的 ref 與密鑰）：

```sql
-- 每分鐘處理佇列（解析、抽取、向量）
select cron.schedule('process-documents', '* * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/process-document',
    headers := jsonb_build_object('content-type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{}'::jsonb);
$$);

-- 每天檢查一次網址來源是否需要更新
select cron.schedule('scheduled-update', '0 3 * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/scheduled-update',
    headers := jsonb_build_object('content-type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{"max_age_hours": 168}'::jsonb);
$$);
```

沒設 Cron 也能運作，只是失敗的工作不會自動重試、網址來源不會自動更新。

---

## 5. 上線檢查清單

依序做完，每一步都要看到預期結果才往下走。

### 5.1 部署本身

- [ ] GitHub Actions 的 `CI` 綠燈（lint、typecheck、test、build、e2e）
- [ ] GitHub Actions 的 `Supabase Migrations` 綠燈
- [ ] Vercel Production 部署成功
- [ ] 開啟首頁沒有出現「這個部署環境沒有讀到 Supabase 環境變數」的黃色提示

### 5.2 帳號與權限

- [ ] `/login` 可以註冊或登入
- [ ] 登入後自動導向 `/dashboard`
- [ ] 登出後開 `/knowledge` 會被導回 `/login`
- [ ] Supabase → Table Editor → `profiles` 有一筆對應的資料

### 5.3 匯入與處理

- [ ] `/import` 按「載入示範資料」，三篇文章全部成功
- [ ] `/sources` 看得到三份來源，狀態為已完成
- [ ] `/review` 有 36 筆候選事實，狀態涵蓋核定／待修正／駁回／待審核
- [ ] `/knowledge` 有 18 筆正式事實，且每一筆都看得到原文片段
- [ ] `/entities` 與 `/relations` 有資料（由核定事實自動建立）

### 5.4 使用

- [ ] `/knowledge` 按「補齊向量」後，`/search` 搜「汞」有結果
- [ ] `/ask` 問「孕婦吃魚要注意什麼」，回答每段都有 `[K-xxxx]` 編號
- [ ] 問一個知識庫沒有的主題，回答會說明「核定事實不足」而不是硬答
- [ ] `/verify/[id]` 看得到綠黃紅逐句判定
- [ ] `/generate` 產生一份 FAQ，句子旁有驗證結果

### 5.5 阻擋機制（最重要）

- [ ] 在素材頁把某一句改成知識庫沒有的內容 → 儲存後標為紅色，且不能定稿
- [ ] 有紅色句子的問答，`published_answer` 在資料庫中是 null
- [ ] `/import` 上傳一個 `source_quote` 是佔位符的檔案 → 被擋下且沒有寫入任何資料

### 5.6 匯出與備份

- [ ] `/export` 三種格式都下載得到，內容不是空的
- [ ] 待選事實包內含欄位說明與三項校正目標
- [ ] 依 `docs/BACKUP.md` 做過一次資料庫備份

---

## 6. 常見問題

**Preview 網址出現 “a server-side exception has occurred”**
環境變數只加到 Production。到 Vercel 把 Environments 補勾 Preview，重新部署。

**頁面說「資料表不存在」或功能無法使用**
`Supabase Migrations` workflow 沒跑成功。到 Actions 看失敗原因；
最常見的是 GitHub Secrets 缺漏。

**候選事實一直沒有出現**
解析或抽取工作卡住。到 `/history` 看背景工作狀態；
`scheduled-update` 會把逾時的工作放回佇列，也可以在來源頁手動重新解析。

**搜尋沒有結果，但 `/knowledge` 有資料**
新事實還沒有向量。到 `/knowledge` 按「補齊向量」。
關鍵字搜尋在沒有向量時仍可運作，只是排序品質較差。
