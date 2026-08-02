# 環境荷爾蒙怎麼讓我內分泌失調的？——緒論

來源：<https://topic.moenv.gov.tw/chemiknowledgemap/cp-224-12793-eb4dc-5.html>
（環境部化學物質管理署，2025-12-26）

原始整理包共 90 筆原子命題，依可回溯性拆成三份。

| 檔案                         | 筆數 | 說明                                         |
| ---------------------------- | ---- | -------------------------------------------- |
| `moenv-endocrine-intro.json` | 44   | **可直接匯入**，0 錯誤 0 警告                |
| `pending-sources/`           | 33   | 整理自外部文獻，各自需要先匯入自己的來源文件 |
| `rejected.json`              | 13   | 標為駁回，系統不匯入，留檔備查               |

## 可匯入的 44 筆

`moenv-endocrine-intro.json`。到 `/import` 上傳即可，不需要另外給原文——
段落已經包在檔案裡（P-001～P-006）。

包內 20 筆標為核定、24 筆待審核。要沿用核定結果，
匯入畫面上的「沿用人工核定結果」要勾起來（`human_review: completed` 會預先勾好）。

## 待補來源的 33 筆

這些命題整理自外部文獻，環境部這篇文章裡沒有可引用的原文，
因此**不能**併進上面那一份——每一筆原子命題的引句都必須真的存在於它所屬的來源文件裡。

已依佐證來源分成 15 組，一組一檔。每一組的處理方式相同：

1. 到 `/import`，把該組的來源網址（或 PDF）當成一份新來源送出，等狀態變成 `ready`
2. 在同一頁選這份原文，附上該組的 JSON 當作原子命題包
3. 系統會用內容比對找出每一筆屬於哪一段；由系統定位的引句一律強制待審核，到 `/review` 逐筆確認

| 檔案                                 | 筆數 | 來源                                                                                                                                                                                                    | 類型                      |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `E03-env-research.json`              | 5    | [Exposure, toxicological mechanism of endocrine disru](https://doi.org/10.1016/j.envres.2023.115577)<br>Environmental Research                                                                          | 同儕審查期刊              |
| `E04-atsdr-pfas.json`                | 3    | [Properties: PFAS Information for Clinicians](https://www.atsdr.cdc.gov/pfas/hcp/clinical-overview/properties.html)<br>U.S. Agency for Toxic Substances and Disease Registry (ATSDR)                    | 政府機關                  |
| `E05+E06-japan-moe-nimd.json`        | 3    | [Minamata Disease: The History and Measures](https://www.env.go.jp/en/chemi/hs/minamata2002/ch2.html)<br>Ministry of the Environment, Government of Japan                                               | 政府機關                  |
| `E07-eu-commission.json`             | 3    | [Industrial accidents](https://environment.ec.europa.eu/topics/industrial-emissions-and-safety/industrial-accidents_en)<br>European Commission                                                          | 政府機關                  |
| `E08-us-epa-hero.json`               | 3    | [DDE and eggshell thinning references](https://hero.epa.gov/reference/3064007/)<br>U.S. Environmental Protection Agency HERO                                                                            | government_research_index |
| `E09-nasem.json`                     | 3    | [Veterans and Agent Orange: Update 11 (2018)](https://nap.nationalacademies.org/catalog/25137/veterans-and-agent-orange-update-11-2018)<br>National Academies of Sciences, Engineering, and Medicine    | national_academy          |
| `E01+E03-niehs-env-research.json`    | 2    | [Endocrine Disruptors](https://www.niehs.nih.gov/health/topics/agents/endocrine)<br>U.S. National Institute of Environmental Health Sciences (NIEHS)                                                    | 政府機關                  |
| `E02-who-unep.json`                  | 2    | [State of the Science of Endocrine Disrupting Chemica](https://iris.who.int/bitstreams/173c5e04-99fd-4f83-972f-7913d7d8e6b1/download)<br>World Health Organization / UNEP                               | 國際組織                  |
| `E10-niddk.json`                     | 2    | [Hypothyroidism (Underactive Thyroid)](https://www.niddk.nih.gov/health-information/endocrine-diseases/hypothyroidism)<br>U.S. National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK) | government_health         |
| `E11-moenv-cha.json`                 | 2    | [我國跨部會環境荷爾蒙管理](https://www.cha.gov.tw/cp-23-2120-5656e-1.html)<br>環境部化學物質管理署                                                                                                      | 政府機關                  |
| `E01-niehs.json`                     | 1    | [Endocrine Disruptors](https://www.niehs.nih.gov/health/topics/agents/endocrine)<br>U.S. National Institute of Environmental Health Sciences (NIEHS)                                                    | 政府機關                  |
| `E02+E03-who-unep-env-research.json` | 1    | [State of the Science of Endocrine Disrupting Chemica](https://iris.who.int/bitstreams/173c5e04-99fd-4f83-972f-7913d7d8e6b1/download)<br>World Health Organization / UNEP                               | 國際組織                  |
| `E05-japan-moe.json`                 | 1    | [Minamata Disease: The History and Measures](https://www.env.go.jp/en/chemi/hs/minamata2002/ch2.html)<br>Ministry of the Environment, Government of Japan                                               | 政府機關                  |
| `E12-pubmed-seveso-abortion.json`    | 1    | [Seveso Women's Health Study: TCDD and spontaneous ab](https://pubmed.ncbi.nlm.nih.gov/24291766/)<br>Peer-reviewed research indexed by PubMed                                                           | 同儕審查期刊              |
| `E13-pubmed-seveso-cancer.json`      | 1    | [Long-term cancer follow-up after the Seveso accident](https://pubmed.ncbi.nlm.nih.gov/19754930/)<br>Peer-reviewed research indexed by PubMed                                                           | 同儕審查期刊              |

### 先做哪幾組

`E11-moenv-cha.json` 的來源同樣是化學署（我國跨部會環境荷爾蒙管理），
網域是 `cha.gov.tw`，抓取與權責判定都最單純，建議從這組開始。

`E12`／`E13` 指向 PubMed 摘要頁，內容很短、命題也只有各一筆，可以順手做掉。

`E02-who-unep.json` 的來源是 WHO 的 PDF 報告（數百頁），
解析成本高且段落很多，建議最後處理，或改引用其中特定章節。

## 為什麼要拆

系統的核心規則是：**每一筆正式原子命題都要能回到某一份來源文件的某一段原文**。
那 33 筆在環境部這篇文章裡沒有對應段落，硬掛上去就會產生錯誤歸屬——
原始檔案裡就有兩筆因為沒寫段落編號而差點被掛到圖片說明那一段
（見 `tests/unit/article-pack.test.ts` 的「沒有段落編號時不猜段落」）。

格式細節見 [`docs/ARTICLE-PACK.md`](../../docs/ARTICLE-PACK.md)。
