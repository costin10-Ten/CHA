# 個人原子知識庫 — 需求與設計草案

**狀態：已實作。** 路由在 `/pkb`，資料表加 `pkb_` 前綴。

與 CHA（風險溝通產製系統）共用同一個 repo、Vercel 專案與 Supabase 資料庫，
但**不共用資料表**——兩套系統的核心規則相反，混用會讓規則互相汙染。

---

## 一、使用者提出的需求（原文）

1. 品名：個人原子知識庫
2. 不挑知識，原文章沒引用的，只要標註來源就可進正式知識
3. 駁回的知識直接丟進「垃圾桶」區，不顯示出來
4. 來源：科普文章、國內法規、本屬業務、環境部新聞、國外管理制度、
   國外最新新聞、本部重點推動、模擬題、正式發想點
5. 我在其他 LLM 產出匯入包，不再用系統做審核
6. 保留人工審核＋同意
7. 正式原子知識作向量及圖譜
8. 做搜尋
9. 整個知識庫可以提供給其他 LLM 做問答

---

## 二、與 CHA 的關鍵差異

這一版**明顯更小**，因為最貴的兩塊（AI 抽取、素材產製）都拿掉了。

| 面向       | CHA                                | 個人原子知識庫               |
| ---------- | ---------------------------------- | ---------------------------- |
| 知識怎麼來 | 系統內 AI 抽取 + 外部匯入          | **只有外部匯入**             |
| 可回溯性   | 引句必須逐字存在於來源文件的某一段 | **只要標註來源**，不比對原文 |
| 原文       | 必須有，且要解析成段落             | 不必有                       |
| 駁回       | 保留紀錄、狀態為 rejected          | **移到垃圾桶，清單不顯示**   |
| 審核       | AI 品質檢查 + 人工                 | **只有人工**                 |
| 分類       | 九類命題分類（內容面）             | **九類來源分類**（出處面）   |
| 產出       | FAQ／文章／podcast／短影音／圖卡   | 無                           |
| 驗證       | 逐句綠黃紅 + 三層驗證              | 無                           |
| 對外       | 內部使用                           | **供其他 LLM 問答**          |

**最重要的一點**：需求 2 拿掉了 CHA 的核心約束（引句必須存在於原文）。
這是刻意的取捨——個人使用、單一使用者、不對外發布，不需要那道防線。
代價是知識的可信度改由「來源標註」承擔，所以來源欄位必須是必填。

---

## 三、資料結構草案

```
knowledge_items          正式原子知識（沒有「候選」與「正式」兩張表）
  id, owner_id
  statement              一句一事的敘述          必填
  source_type            九類來源分類            必填
  source_label           來源名稱（文章標題／法規名稱／新聞標題）必填
  source_url             來源網址                選填
  source_note            補充說明（頁碼、章節、發布日期）選填
  subject / predicate / object   圖譜用           選填
  tags                   text[]
  status                 draft | active | trashed
  trashed_at             進垃圾桶的時間
  approved_at            人工同意的時間
  content_hash           去重用
  created_at / updated_at

import_batches           一次匯入的紀錄
  id, owner_id, filename, item_count, created_at, raw_json

review_log               人工審核歷程（同意／退回／丟垃圾桶／還原）
  id, owner_id, knowledge_item_id, action, note, created_at

entities / relations     圖譜（沿用 CHA 的做法）
embedding_records        向量，帶 is_active 做增量更新
```

### 為什麼只有一張知識表

CHA 分成 `candidate_facts` 與 `knowledge_facts`，是因為 AI 抽出來的東西
必須先隔離、審過才能變成官方知識。這一版沒有 AI 抽取，匯入的內容已經是
使用者自己在別的 LLM 整理好的，用 `status` 一個欄位區分即可：

- `draft` — 剛匯入，等人工同意
- `active` — 已同意，進入向量、圖譜與搜尋
- `trashed` — 丟進垃圾桶，清單不顯示

### 垃圾桶

`status = 'trashed'` + `trashed_at`，不硬刪。
所有列表查詢預設 `status <> 'trashed'`，另開一個 `/trash` 頁可以看與還原。

不硬刪的理由：硬刪之後同一筆知識會在下次匯入時再出現一次，
而且沒有紀錄可以說明「這條當初為什麼不要」。

---

## 四、九類來源分類

| 識別碼               | 中文         | 備註                          |
| -------------------- | ------------ | ----------------------------- |
| `popular_science`    | 科普文章     |                               |
| `domestic_law`       | 國內法規     |                               |
| `own_duty`           | 本署業務     | ⚠️ 原文寫「本屬業務」，待確認 |
| `moenv_news`         | 環境部新聞   |                               |
| `foreign_regulation` | 國外管理制度 |                               |
| `foreign_news`       | 國外最新新聞 |                               |
| `ministry_priority`  | 本部重點推動 |                               |
| `mock_question`      | 模擬題       | 自製，非外部來源              |
| `formal_idea`        | 正式發想點   | 自製，非外部來源              |

**要注意的地方**：最後兩類（模擬題、正式發想點）不是外部文獻，
是自己產生的內容。需求 2 說「只要標註來源就可進正式知識」，
對這兩類而言「來源」等於「自己」。

建議在資料上把它們標成 `is_self_authored = true`，理由是：
供其他 LLM 問答時（需求 9），對方應該知道哪些是外部依據、
哪些是本人的想法——否則自己的發想會被當成既有事實引用回來。

分類是**單選還是複選**？CHA 那邊的命題分類刻意做成複選（會重疊）；
這裡是「出處」，一筆知識通常只有一個出處，建議**單選**。

---

## 五、功能範圍

### 做

1. **匯入**：貼上或上傳 JSON。格式沿用 CHA 的「寬進嚴審」精神
   （欄位別名、中文列舉值、逐筆跳過），但驗證規則大幅放寬——
   只檢查 `statement` 與 `source_type` / `source_label` 有沒有填
2. **人工審核**：清單 + 單筆。同意（→ active）／編輯後同意／丟垃圾桶
   - 沿用 CHA 的批次操作防線：批次只作用於未決定的項目
3. **垃圾桶**：`/trash` 檢視與還原
4. **向量 + 圖譜**：`status = 'active'` 才建立，增量更新
5. **搜尋**：關鍵字 + 向量混合，可依來源分類與標籤篩選
6. **對外供 LLM 問答**：見下一節

### 不做

- AI 抽取、AI 審核、品質檢查
- 原文解析、段落切分、引句比對
- 素材產製（FAQ／文章／podcast／短影音／圖卡）
- 逐句驗證、三層驗證
- 排程更新

---

## 六、需求 9「提供給其他 LLM 問答」— 待決定

這一項的做法差很多，要先決定。三個選項：

### A. MCP Server（推薦）

開一個 MCP endpoint，提供 `search_knowledge` 與 `get_knowledge` 兩個工具。
Claude Desktop、Claude Code、其他支援 MCP 的客戶端可以直接掛上去。

- 優點：即時、對方拿到的永遠是最新的；可以做語意搜尋而不是整包塞
- 缺點：要處理認證；只有支援 MCP 的客戶端能用

### B. 唯讀 API + 匯出檔

`GET /api/knowledge?q=...` 回 JSON，另提供全量 JSONL／Markdown 下載。

- 優點：任何工具都能用，包含不支援 MCP 的
- 缺點：貼整包進對話會吃掉大量 context

### C. 產生「知識庫快照」貼給 LLM

把 active 的知識匯出成一份結構化 Markdown，人工貼進對話。

- 優點：最簡單，零基礎建設
- 缺點：知識多了就貼不下；每次都要重貼

**初步建議**：先做 B 的匯出檔（成本最低、立刻可用），
介面留好之後再加 A。C 其實是 B 的子集。

---

## 七、技術選型

沿用 CHA 這一套，理由是已經驗證過而且純網頁流程可行：

- Next.js 15 App Router + TypeScript strict + Tailwind
- Supabase：Auth、PostgreSQL、RLS、pgvector、pg_trgm
- Vercel 部署，GitHub Actions 跑 CI 與 migration
- 測試預設 Mock Provider，不呼叫付費 API

**可以拿來直接用的部分**（從 CHA 搬）：

- `supabase/functions/_shared/` 的雙執行環境寫法
- `article-pack.ts` 的「寬進嚴審」正規化（大幅簡化後）
- 審核狀態機與批次操作防線（`lib/facts/review.ts`）
- 向量增量更新（`embedding_records.is_active` + HNSW 部分索引）
- `supabase/scripts/reset-data.sql` 的清空腳本寫法

**要記得帶過去的教訓**：

- migration 的部署分支要與 app 一致，否則 production 會壞
- Vercel 環境變數要設到所有環境，不能只設 Production
- 沒有的資料就是沒有，不要用索引之類的東西「猜」出一個值

---

## 八、已定案的決定

1. **「本署業務」**（原文的「本屬業務」是筆誤），識別碼 `own_duty`
2. **與 CHA 共用同一個 repo、Vercel 專案與 Supabase 資料庫**。
   資料表加 `pkb_` 前綴，路由放在 `/pkb`
3. 需求 9 走**匯出檔**：Markdown（貼進對話）與 JSONL（給程式處理）
4. 來源分類**單選**，另加 `other`，實際出處寫在 `source_label` 與 `source_note`
5. **沿用 CHA 的匯入包格式**：`facts` 會被讀成清單，
   `source.title` 當來源名稱，`proposition_types` 併進標籤

---

## 九、實作對照

| 需求              | 實作                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| 1 品名            | 導覽列「個人原子知識庫」，路由 `/pkb`                                   |
| 2 只要標註來源    | `source_type` + `source_label` 必填，不比對原文                         |
| 3 駁回進垃圾桶    | `status = 'trashed'`，清單／搜尋／匯出一律排除；`/pkb/trash` 可看與還原 |
| 4 九類來源        | `pkb_source_type` 列舉，中文寫法都認得                                  |
| 5 外部 LLM 產包   | `/pkb/import`，系統不做 AI 審核                                         |
| 6 人工審核＋同意  | `/pkb` 清單逐筆或批次同意；批次只作用於待同意                           |
| 7 向量與圖譜      | 同意時建圖譜；`/pkb/search` 補齊向量（增量）                            |
| 8 搜尋            | `pkb_search`：ILIKE + 全文 + 三元組 + 向量                              |
| 9 供其他 LLM 問答 | `/pkb/export` 下載 Markdown／JSONL，開頭附使用說明                      |

### 檔案位置

```
supabase/migrations/20260731000012_personal_kb.sql   資料表、RLS、RPC
supabase/functions/_shared/pkb-pack.ts               匯入包驗證（純函式）
lib/pkb/queries.ts    讀取層（清單一律排除垃圾桶）
lib/pkb/search.ts     檢索與向量
lib/pkb/export.ts     匯出（純函式）
app/pkb/actions.ts    匯入、同意、垃圾桶、還原、補向量
app/pkb/…             知識庫、匯入、搜尋、匯出、垃圾桶
app/api/pkb/export/   下載端點
tests/unit/pkb-pack.test.ts、pkb-export.test.ts
```

### 幾個刻意的設計

- **垃圾桶不硬刪**：硬刪之後同一筆會在下次匯入時再冒出來，
  而且沒有紀錄說明當初為什麼不要。唯一索引排除 trashed，
  所以「丟掉之後重新匯入」仍然可行。
- **還原成待同意，不是直接回到已同意**：既然丟過一次，就該再看一眼。
- **批次只作用於待同意**：CHA 那邊踩過的坑——全選加批次核定
  把已駁回的一起放行。這裡從一開始就擋住。
- **狀態與時間戳用 CHECK 綁在一起**：不會出現「已同意但沒有同意時間」。
- **自製內容一定要標示**：模擬題與正式發想點在匯出檔逐筆標【自製】，
  使用說明也明寫不得當成既有事實引用。沒有這條，
  自己的發想會繞一圈變成「查到的資料」。
