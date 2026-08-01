# 待辦清單

使用者在開發過程中提出、尚未排入當前 Phase 的需求。
完成後把項目移到「已完成」並註明 commit。

## 待辦

（目前沒有未處理的項目。新的需求請往下加。）

## 已完成

### 1. 候選事實清單的全選功能

**來源**：使用者回饋（Phase 4 驗證後）　**完成於**：Phase 8

`/review` 清單加上表頭全選 checkbox：

- 勾選會選取目前畫面上的全部候選事實（受篩選與筆數上限限制）
- 部分選取時顯示中間狀態（indeterminate）
- 按鈕旁標示「已選取 N 筆（本頁共 M 筆）」，避免誤以為選到全資料庫
- 原本的「選取可批次核定的 N 筆」保留，兩者用途不同

實作：`components/review/review-list.tsx`

### 2. 回報 AI 抽取錯誤的按鈕

**來源**：使用者回饋（Phase 4 驗證後）　**完成於**：Phase 8

- 清單與單筆審核頁都有「回報抽取問題」按鈕
- 八種錯誤類型：超出原文、條件遺失、數字錯誤、語氣被放大、
  主詞錯誤、切句錯誤、原文片段對不上、其他
- 記錄候選事實、當時的 `prompt_version_id`、`model_run_id`、使用者說明，
  以及敘述／原文片段／段落全文的快照（候選事實日後被改也看得到問題現場）
- 新資料表 `extraction_feedback`（owner_id + RLS + 時間戳）
- `/settings/prompts` 顯示各提示詞版本的回報數、未處理數與最常見問題類型，
  並可把單筆回報標記為已處理
- 與 `review_records` 分開：那是審核歷程，這是模型品質回饋

實作：`supabase/migrations/20260731000009_drafts_and_feedback.sql`、
`app/review/feedback-actions.ts`、`components/review/feedback-button.tsx`、
`app/settings/prompts/page.tsx`

### 3. 匯出待選事實包（供其他 LLM 處理）

**來源**：使用者回饋（Phase 4 驗證後）　**完成於**：Phase 8

`/export` 可下載待審核候選事實包（JSON），包內自帶：

- **欄位說明**：每個欄位的意義、允許值、可否修改。
  `id`、`source_quote`、`source_paragraph_id`、`source_title`、`source_url`
  標記為不可修改
- **校正目標**（三項，各附具體檢查項目）：
  - 不聳動：不得放大風險、不得使用煽動字眼、保留原文的不確定性
  - 部會權責正確：食品標示與添加物屬衛福部食藥署、農產品產地與農藥殘留屬農業部、
    污染與排放屬環境部、職場暴露屬勞動部職安署；不確定就標記為待確認而非猜測
  - 科學正確性：數值、單位、劑量、暴露途徑、族群不得改動；
    相關性不得寫成因果關係；危害與風險不得混用
- **回填格式**：範例 JSON 與規則（保留 `id`、verdict 允許值、
  不得新增匯出包以外的事實）
- 匯出範圍：依目前篩選條件或指定來源文件
- **回填流程**：貼上或上傳 JSON → 比對 `id` → 檢查不可修改欄位有無被動過
  → 重新執行 `checkFactQuality` → 寫回候選事實並**維持待審核**，
  同時寫一筆 `external_correction` 審核紀錄。回填永遠不會直接核定。

實作：`supabase/functions/_shared/pack.ts`、`app/api/export/route.ts`、
`app/export/actions.ts`、`components/export/pack-import.tsx`、
`supabase/migrations/20260731000010_external_correction.sql`
