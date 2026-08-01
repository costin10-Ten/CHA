# 文章包格式（CHA-database-aligned-export）

在對話或其他工具中整理好一篇文章後，用這個格式交付，於 `/import` 上傳即可匯入。

匯入前一定會先驗證。驗證只看檔案，不寫入任何資料；沒通過就不會匯入任何一筆。

---

## 1. 唯一不能退讓的規則：檔案必須自帶原文

以下三個欄位**必須是真正的文字**，不能是 `$resolve_…` 這類佔位符：

| 欄位                             | 內容                                 |
| -------------------------------- | ------------------------------------ |
| `document_chunks[].text`         | 該段落的實際文字                     |
| `candidate_facts[].source_quote` | 段落中支持該事實的**連續**原文片段   |
| `knowledge_facts[].source_quote` | 同上（可省略，匯入時取候選事實的值） |

原因：匯入端無法從網址自動還原「是原文的哪一段、哪一句」。
網頁改版、段落編號規則不同都會對不上，猜錯就等於偽造引用。
而整個系統的前提是「每一筆事實都能回溯到原文片段」——
沒有原文，品質檢查、逐句驗證與素材產製全部失去意義。

驗證會逐筆比對 `source_quote` 是否真的出現在對應段落的 `text` 中
（忽略空白與標點形式差異）。對不上就擋下。

### 版權考量

只需要提供**有事實引用到的段落**，不需要重製整篇文章。
一篇文章通常只有幾段會產生事實，這是可回溯性的最小必要內容。

---

## 2. 允許的佔位符

指向「由資料庫或匯入流程產生的值」的佔位符是合法的，匯入時會解析：

| 佔位符                            | 解析成                 |
| --------------------------------- | ---------------------- |
| `$auth.uid()`                     | 登入使用者的 UUID      |
| `$import_time` / `$approval_time` | 伺服器時間             |
| `$sources[0].id`                  | 新建立的來源 UUID      |
| `$source_versions[0].id`          | 新建立的版本 UUID      |
| `$document_chunks[P-004].id`      | 依 `paragraph_id` 解析 |
| `$candidate_facts[C001].id`       | 依 `ref` 解析          |

`$resolve_source_paragraph(...)`、`$resolve_quote(...)`、
`$resolve_paragraph_hash(...)` 這類**內容**佔位符一律擋下（見上一節）。

---

## 3. 由系統計算、不必提供的欄位

| 欄位                             | 說明                                         |
| -------------------------------- | -------------------------------------------- |
| `content_hash`、`statement_hash` | 一律重算，才能與其他匯入路徑用同一套規則去重 |
| `char_start`、`char_end`         | 沒給就依段落順序推算                         |
| `id`、`owner_id`、各種時間戳     | 由資料庫產生                                 |
| `source_versions[].chunk_count`  | 依實際段落數覆寫                             |

給了也不會用，不必為了湊欄位而編造。

---

## 4. 結構

```jsonc
{
  "export_meta": {
    "format": "CHA-database-aligned-export",
    "format_version": 2,
    "document_id": "DOC-001",
    "human_review": "completed", // 人工審核完成才寫 completed
  },

  "sources": [
    // 一個檔案剛好一篇文章
    {
      "title": "文章標題",
      "source_type": "url", // text | file | url
      "origin_url": "https://example.gov.tw/article",
      "mime_type": "text/html",
      "byte_size": 12345,
    },
  ],

  "source_versions": [
    { "version": 1, "parser_version": "chat-workflow/1.0", "char_count": 1288 },
  ],

  "document_chunks": [
    {
      "paragraph_id": "P-004", // 事實回溯原文的定位依據，同一版本內唯一
      "position": 4, // 排序用，建議用文章中的實際順序
      "block_type": "paragraph",
      "heading_path": ["小節標題"],
      "text": "這一段的實際文字。", // 必填，不可為佔位符
    },
  ],

  "candidate_facts": [
    {
      "ref": "C001", // 檔案內的識別碼，供其他表參照
      "statement": "一句一事的候選事實。",
      "subject": "主體",
      "predicate": "關係",
      "object": "客體",
      "knowledge_type": "substance", // substance|concept|policy|event|topic|other
      "risk_level": "medium", // low|medium|high
      "conditions": {
        "population": null,
        "exposure_route": null,
        "dose": null,
        "duration": null,
        "location": null,
        "timeframe": null,
      },
      "source_paragraph_id": "P-004",
      "source_quote": "段落中支持這句話的連續片段", // 必填，必須在該段落中找得到
      "status": "approved", // pending|approved|rejected|needs_fix|merged|split
      "confidence": 0.78,
      "quality_flags": ["inference_suspected"],
      "quality_score": 85,
      "review_note": "AI 審核意見",
      "edited": true,
      "original_statement": "修正前的敘述",
    },
  ],

  "review_records": [
    {
      "candidate_fact_id": "$candidate_facts[C001].id",
      "action": "approve_with_edit", // approve|approve_with_edit|reject|needs_fix|
      // split|merge|reextract|reopen|external_correction
      "from_status": "pending",
      "to_status": "approved",
      "note": "核定理由",
      "changes": { "statement": { "from": "修正前", "to": "修正後" } },
    },
  ],

  "knowledge_facts": [
    {
      "ref": "F001",
      "candidate_fact_id": "$candidate_facts[C001].id", // 必須指向 approved 的候選事實
      "statement": "與候選事實相同的敘述",
      "tags": ["標籤"],
    },
  ],

  "processing_jobs": [
    {
      "job_type": "extract_facts",
      "status": "completed",
      "result": { "ai_review": {}, "citation_review": {} }, // AI 審核紀錄保存於此
    },
  ],
}
```

---

## 5. 驗證會擋下什麼

| 情況                                    | 級別 |
| --------------------------------------- | ---- |
| 段落文字或原文引句是佔位符 / 空白       | 錯誤 |
| 引句不在對應段落的文字中                | 錯誤 |
| 事實引用了 `document_chunks` 沒有的段落 | 錯誤 |
| `paragraph_id` 或 `ref` 重複            | 錯誤 |
| 列舉值不合法                            | 錯誤 |
| 正式事實對應不到候選事實                | 錯誤 |
| 正式事實對應的候選事實不是 `approved`   | 錯誤 |
| `sources` 不是剛好一筆                  | 錯誤 |
| 正式事實的敘述與候選事實不一致          | 提醒 |
| 候選事實已核定但沒有對應的正式事實      | 提醒 |
| 審核紀錄對應不到候選事實                | 提醒 |

---

## 6. 匯入行為

1. **同一個 `origin_url` 只能匯入一次**。要更新內容請走來源頁的重新解析，
   走增量更新流程，不要重複匯入。
2. **正式事實一律由 `promote_candidate_fact` 產生**，不直接寫入
   `knowledge_facts`——版本、`fact_versions` 與實體關聯才會與系統其他路徑一致。
3. **預設全部以「待審核」匯入**。要沿用檔案中的人工核定結果，
   必須在畫面上明確勾選（檔案標示 `human_review: "completed"` 時會預先勾好）。
4. 匯入後新的正式事實還沒有向量，請到正式事實頁補齊，才會進入搜尋與問答。
