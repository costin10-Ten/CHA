# 專案現況存檔

**存檔時間**：2026-08-03　**commit**：`e26bd7d`（`main` 與 `claude/read-from-27-i7xdz2` 一致）

這份是交接用的快照：做完了什麼、還沒做什麼、有哪些待決定的事。
架構細節看 [`ARCHITECTURE.md`](ARCHITECTURE.md)，待辦看 [`BACKLOG.md`](BACKLOG.md)。

---

## 一、目前狀態

九個 Phase 全部完成並上線。388 個單元測試、Playwright 冒煙測試、
lint / format / typecheck / build 全綠。

| 項目          | 狀態                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| GitHub        | `main` = `e26bd7d`                                                             |
| Vercel        | 部署 `main`（production）                                                      |
| Supabase      | 11 個 migration 全部套用，含 `20260731000011_proposition_types`                |
| Edge Function | `process-document`、`extract-facts`、`generate-embeddings`、`scheduled-update` |
| 測試          | 388 passed / 25 files                                                          |

### 這一輪（Phase 9 之後）改了什麼

1. **駁回的原子命題不得成為正式知識**（`b17fa8c`）
   - 狀態機：已駁回不能一步核定，必須先退回待審核
   - 批次操作只作用於待審核與待確認；全選不再包含已做過決定的
   - 匯入時標為駁回的一律略過，不建立候選項
2. **術語改為「原子命題」、分類改為可複選九類**（`c1d2735`）
   - `knowledge_type`（單選六類）→ `proposition_types`（陣列，九類）
   - 「醫學健康建議」須為政府機關來源，違反時標記但不硬擋
   - 使用者可見文字與文件全部改用「原子命題」；**資料表與程式識別碼維持英文 `fact`／`facts`**
3. **修正段落編號猜測與別名誤報**（`656d289`）
   - 沒寫 `paragraph_id` 時不再從索引推算（會造成錯誤歸屬）
   - 用別名對上不再回報「無法辨識」
4. **匯入失敗時顯示真正的原因**（`1c068a5`）
   - 寫入階段的失敗原因原本被吞掉，只顯示驗證提醒

---

## 二、踩過的坑（會再發生的）

### migration 與 app 的部署脫節 ✅ 已處理

`db-migrate.yml` 原本的觸發分支含 `claude/**`，但 Vercel 只部署 `main`。
推功能分支時 migration 先上線、app 還是舊的，**production 會壞掉**。

實際發生過一次：`20260731000011` 把 `knowledge_type` 欄位刪掉之後，
線上還在寫這個欄位，所有匯入都失敗，而且錯誤原因當時還被吞掉。

**處理方式**：觸發分支改成只有 `main`（`tests/unit/workflow-guards.test.ts`
會擋住改回去）。要在 Preview 驗證新結構時用 `workflow_dispatch` 手動跑。

即使兩者都從 `main` 上線，生效時間仍有落差（Supabase 幾秒、Vercel 要重建），
所以**破壞性變更一律拆兩步**：先加新欄位並讓程式同時支援新舊 → 合併上線
→ 下一個 migration 才移除舊欄位。加法式變更（新增資料表／欄位）可以一次做完。

### Vercel 環境變數的 scope

環境變數只設 Production 時，Preview 讀不到，頁面會出現
「Application error」。middleware 與 `getCurrentUser()` 已經處理成
導回首頁顯示設定提示，但根因還是要把變數設到所有環境。

---

## 三、資料現況

`data/environmental-hormone/`（環境荷爾蒙緒論，環境部化學物質管理署）

| 檔案                         | 筆數 | 狀態                                         |
| ---------------------------- | ---- | -------------------------------------------- |
| `moenv-endocrine-intro.json` | 44   | **尚未匯入**。驗證 0 錯誤 0 警告，可直接上傳 |
| `pending-sources/`（15 組）  | 33   | 需要先各自匯入來源文件才能掛上去             |
| `rejected.json`              | 13   | 駁回紀錄，只留檔不匯入                       |

`tests/unit/data-packs.test.ts` 會驗證這些檔案，避免存進版控卻匯不進去。

---

## 四、未完成的事

### 已寫進 BACKLOG，設計定案但未實作

- **項目 4**：三層驗證（自動／AI／人工）。AI 層不擋發布，只給建議性文字
- **項目 5**：公開事實庫（發布快照表 + 對外 feed + 墓碑記錄）
- **項目 6**：搜尋系統民眾回饋（Word 匯回 → AI 分流 → 待選修正）
- **項目 7**：`candidate_facts.origin`（`extraction` / `feedback` / `human_edit`），
  是 4、6 的共用前置

### 其他

- `docs/DEPLOY.md` §5 的 Production 驗證清單還沒實際跑過一輪
- `data/` 那 44 筆還沒真的匯進資料庫

---

## 五、不可退讓的規則（工作單 §4、§5.1、§21、§25）

搬到新專案時要重新確認這些還適不適用：

- 每一張主要資料表都有 `owner_id` + RLS；**修權限問題不得關閉 RLS**
- 前端只能拿到 `NEXT_PUBLIC_SUPABASE_URL` 與 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；
  `SUPABASE_SECRET_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 絕不進瀏覽器也不進 git
- 檔案不經過 Vercel API：瀏覽器拿簽章網址直傳 Supabase Storage
- AI 結果不得直接成為正式知識；正式知識一律經 `promote_candidate_fact`
- 測試預設走 Mock Provider，不呼叫付費 API
- 向量增量更新，不整批重建
- 禁用：FastAPI、Streamlit、SQLite、Docker Compose、本地 PostgreSQL
