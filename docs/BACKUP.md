# 備份與還原

工作單第 17 節要求的備份說明。分成三部分：資料庫、Storage 檔案、程式與設定。

備份操作需要 `SUPABASE_SECRET_KEY`（service key）或資料庫密碼，
**只能在本機或 CI 執行，不可放進前端，也不可提交進 Git**。

---

## 1. 應用內匯出（不需要金鑰）

登入後在 `/export` 可下載：

| 內容             | 格式                | 用途                         |
| ---------------- | ------------------- | ---------------------------- |
| 正式事實         | JSON／CSV／Markdown | 內容備份、交給他人閱讀       |
| 事實與來源對照表 | JSON／CSV／Markdown | 稽核：每筆事實出自哪一段原文 |
| 單篇文件與其事實 | JSON／Markdown／CSV | 單一主題的完整封存           |
| 待選事實包       | JSON                | 丟給其他 LLM 交叉校正後回填  |

這些匯出走使用者的登入狀態，RLS 保證只會匯出自己的資料。
它們是「內容備份」，不含使用者帳號、工作佇列與向量，
**不能取代下面的資料庫備份**。

---

## 2. Supabase 資料庫備份

### 2.1 自動備份

Supabase 專案本身有每日自動備份（保留天數依方案而定），
可在 Dashboard → Database → Backups 查看與還原。
免費方案的保留期較短，重要資料請自行加做下面的邏輯備份。

### 2.2 手動邏輯備份（建議定期執行）

需要先安裝 Supabase CLI 並登入。連線字串可在
Dashboard → Project Settings → Database → Connection string 取得。

```bash
# 只備份資料（含 auth schema 以外的自有資料）
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f backup-data.sql

# 備份結構（正常情況下用 supabase/migrations 就能重建，這份作為對照）
supabase db dump --db-url "$SUPABASE_DB_URL" -f backup-schema.sql
```

備份檔含個人資料，請加密保存，不要放進 Git。

### 2.3 需要備份的資料表

```text
profiles              使用者設定
sources               來源文件
source_versions       文件版本（含原始文字）
document_chunks       段落
candidate_facts       候選事實
review_records        審核歷程
extraction_feedback   抽取問題回報
knowledge_facts       正式事實
fact_versions         事實版本
entities / relations  實體與關聯
embedding_records     向量（可由事實重建，備份可省略）
answer_sessions       問答紀錄
answer_evidence       證據包
answer_sentences      逐句驗證
communication_drafts  風險溝通素材
prompt_versions       提示詞版本
model_runs            模型用量
processing_jobs       工作佇列（執行中的狀態，不必備份）
```

`embedding_records` 與 `processing_jobs` 可以不備份：
向量能從正式事實重新產生，佇列是暫時狀態。

---

## 3. Storage 檔案備份

Bucket 名稱：`sources`。路徑結構：

```text
sources/{owner_id}/{source_id}/original.<ext>     上傳或貼入的原始內容
sources/{owner_id}/{source_id}/raw.html           網址來源抓到的原始 HTML
sources/{owner_id}/{source_id}/parsed-v{n}.json   每一版的解析結果
```

下載整個 bucket：

```bash
# 需要 service key，請用環境變數帶入，不要寫進指令歷史
export SUPABASE_ACCESS_TOKEN=...
supabase storage cp -r ss://sources ./storage-backup --experimental
```

也可以在 Dashboard → Storage → sources 逐一下載。

---

## 4. 還原步驟

還原是危險操作，請先確認要還原到哪一個時間點，並在還原前另外備份現況。

### 4.1 還原到新的 Supabase 專案（建議）

1. 建立新的 Supabase 專案。
2. 套用結構：把新專案的 ref 設為 GitHub Secret `SUPABASE_PROJECT_REF`，
   推送任一次 commit 觸發 `.github/workflows/db-migrate.yml`，
   或在本機執行 `supabase link` 後 `supabase db push`。
   結構完全來自 `supabase/migrations/`，不需要用 schema 備份。
3. 還原資料：
   ```bash
   psql "$SUPABASE_DB_URL" -f backup-data.sql
   ```
4. 還原 Storage：
   ```bash
   supabase storage cp -r ./storage-backup ss://sources --experimental
   ```
5. 重建向量（不需要還原 `embedding_records`）：
   在 `/knowledge` 按「補齊向量」，或直接呼叫 Edge Function
   `generate-embeddings`，它會為所有沒有現行向量的事實補齊。
6. 更新 Vercel 環境變數（`NEXT_PUBLIC_SUPABASE_URL`、
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`）並重新部署。
7. 重新設定 Cron（見 README 的「背景工作排程」）。

### 4.2 只還原部分資料

單一資料表的誤刪，優先用應用內的版本紀錄修復：

- 正式事實：`fact_versions` 與 `knowledge_facts.supersedes` 保留了每一版
- 候選事實：`review_records` 記錄了每一次修改前後的內容
- 文件：`source_versions` 保留每一版原文，重新解析不會覆蓋舊版

只有在這些都無法還原時，才從資料庫備份取出該表的資料。

---

## 5. 驗證備份可用

備份沒有驗證過就等於沒有備份。建議每季做一次：

1. 建一個臨時 Supabase 專案
2. 依 4.1 還原
3. 登入、開 `/knowledge` 確認事實數量與正式環境一致
4. 開 `/search` 搜尋一個關鍵字，確認補齊向量後有結果
5. 刪除臨時專案

---

## 6. 清空資料重來

要把知識資料全部清掉、從乾淨的狀態重新匯入時，用
`supabase/scripts/reset-data.sql`：

1. **先到 `/export` 匯出一份備份**（這個動作不可復原）
2. Supabase Dashboard → SQL Editor → 貼上 `supabase/scripts/reset-data.sql`
3. 把腳本開頭的 `v_email` 換成你的登入信箱
4. Run

會刪除：來源文件、文件版本、段落、候選事實、審核紀錄、正式事實、事實版本、
實體、關聯、向量索引、問答紀錄、素材草稿、抽取回報、工作佇列、模型呼叫紀錄。

不會刪除：你的帳號、`profiles`、`prompt_versions`（提示詞版本），
以及所有資料表結構——不需要重跑 migrations。

上傳的檔案本體在 Storage，不會一起刪；腳本結尾有一段註解起來的 SQL 可以一併清掉。
