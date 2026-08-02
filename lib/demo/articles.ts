/**
 * 示範資料（工作單第 22 節）。
 *
 * 三篇短文全部自行撰寫，不複製任何受版權保護的文章。
 * 內容刻意包含「原文帶不確定語氣」「條件限定」「機關權責」等情境，
 * 讓審核、驗證與素材產製的規則在示範資料上就能看出作用。
 *
 * 每篇的候選原子命題涵蓋全部審核狀態：
 * 6 筆核定、2 筆待修正、2 筆駁回、2 筆待審核。
 * 被駁回的兩筆是真實會發生的抽取錯誤（聳動、超出原文），不是湊數。
 *
 * 這裡的資料會走與一般匯入完全相同的驗證與匯入路徑，
 * 因此 source_quote 必須真的是段落的連續片段——單元測試會檢查。
 */

export interface DemoParagraph {
  paragraph_id: string;
  position: number;
  heading_path: string[];
  text: string;
}

export interface DemoCandidate {
  ref: string;
  statement: string;
  subject: string;
  predicate: string;
  object: string;
  proposition_types: string[];
  risk_level: string;
  conditions?: Record<string, string | null>;
  source_paragraph_id: string;
  source_quote: string;
  status: "approved" | "needs_fix" | "rejected" | "pending";
  quality_flags?: string[];
  quality_score?: number;
  review_note?: string;
  tags?: string[];
}

export interface DemoArticle {
  slug: string;
  title: string;
  originUrl: string;
  /** 產製素材時用的主題。 */
  topic: string;
  paragraphs: DemoParagraph[];
  candidates: DemoCandidate[];
}

const HYDROFLUORIC: DemoArticle = {
  slug: "hydrofluoric-acid",
  title: "示範：氫氟酸的危害與處置",
  originUrl: "https://demo.local/cha/hydrofluoric-acid",
  topic: "氫氟酸的危害與接觸後處置",
  paragraphs: [
    {
      paragraph_id: "P-001",
      position: 1,
      heading_path: ["氫氟酸是什麼"],
      text: "氫氟酸是氟化氫溶於水形成的溶液，在半導體製造、玻璃蝕刻與金屬表面清洗等工業製程中使用。它的腐蝕性與一般強酸不同：低濃度接觸皮膚時，初期可能沒有明顯疼痛，因此容易延誤處理。",
    },
    {
      paragraph_id: "P-002",
      position: 2,
      heading_path: ["危害機制"],
      text: "氟離子可以穿透皮膚，並與體內的鈣離子及鎂離子結合，造成組織深層損傷。大面積或高濃度暴露時，可能導致血鈣濃度下降，嚴重時影響心律。這類全身性影響通常出現在暴露面積較大的個案，並不是每一次接觸都會發生。",
    },
    {
      paragraph_id: "P-003",
      position: 3,
      heading_path: ["接觸後怎麼辦"],
      text: "皮膚接觸氫氟酸後，應立即以大量清水沖洗，並儘速就醫。含葡萄糖酸鈣的凝膠可用於皮膚接觸後的初步處置，但仍需由醫療人員評估後續治療。眼睛接觸時應持續沖洗並立即送醫。",
    },
    {
      paragraph_id: "P-004",
      position: 4,
      heading_path: ["誰在管"],
      text: "氫氟酸屬於毒性及關注化學物質管理法列管的化學物質，源頭與流布管理由環境部化學物質管理署主管。工作場所的暴露管制與勞工健康保護，則屬勞動部職業安全衛生署的權責。",
    },
    {
      paragraph_id: "P-005",
      position: 5,
      heading_path: ["日常接觸"],
      text: "一般家庭不會使用工業用氫氟酸。部分除鏽劑或清潔劑含有氟化物成分，使用前應閱讀產品標示並依說明使用。",
    },
  ],
  candidates: [
    {
      ref: "C001",
      statement: "氫氟酸是氟化氫溶於水形成的溶液。",
      subject: "氫氟酸",
      predicate: "是",
      object: "氟化氫溶於水形成的溶液",
      proposition_types: ["substance_property"],
      risk_level: "low",
      source_paragraph_id: "P-001",
      source_quote: "氫氟酸是氟化氫溶於水形成的溶液",
      status: "approved",
      tags: ["氫氟酸", "化學性質"],
    },
    {
      ref: "C002",
      statement: "氫氟酸低濃度接觸皮膚時，初期可能沒有明顯疼痛。",
      subject: "氫氟酸",
      predicate: "低濃度接觸皮膚初期",
      object: "可能沒有明顯疼痛",
      proposition_types: ["substance_property", "toxicology_mechanism"],
      risk_level: "high",
      conditions: { exposure_route: "皮膚接觸", dose: "低濃度" },
      source_paragraph_id: "P-001",
      source_quote: "低濃度接觸皮膚時，初期可能沒有明顯疼痛",
      status: "approved",
      tags: ["氫氟酸", "皮膚接觸"],
    },
    {
      ref: "C003",
      statement: "氟離子可以穿透皮膚，並與體內的鈣離子及鎂離子結合。",
      subject: "氟離子",
      predicate: "可穿透皮膚並結合",
      object: "體內的鈣離子及鎂離子",
      proposition_types: ["chemistry_concept", "toxicology_mechanism"],
      risk_level: "medium",
      conditions: { exposure_route: "皮膚接觸" },
      source_paragraph_id: "P-002",
      source_quote: "氟離子可以穿透皮膚，並與體內的鈣離子及鎂離子結合",
      status: "approved",
      tags: ["氟離子", "作用機制"],
    },
    {
      ref: "C004",
      statement: "皮膚接觸氫氟酸後，應立即以大量清水沖洗，並儘速就醫。",
      subject: "皮膚接觸氫氟酸",
      predicate: "應立即",
      object: "以大量清水沖洗並儘速就醫",
      proposition_types: ["health_advice"],
      risk_level: "high",
      conditions: { exposure_route: "皮膚接觸" },
      source_paragraph_id: "P-003",
      source_quote: "應立即以大量清水沖洗，並儘速就醫",
      status: "approved",
      tags: ["急救", "氫氟酸"],
    },
    {
      ref: "C005",
      statement: "氫氟酸的源頭與流布管理由環境部化學物質管理署主管。",
      subject: "氫氟酸",
      predicate: "源頭與流布管理主管機關為",
      object: "環境部化學物質管理署",
      proposition_types: ["domestic_policy"],
      risk_level: "low",
      source_paragraph_id: "P-004",
      source_quote: "源頭與流布管理由環境部化學物質管理署主管",
      status: "approved",
      tags: ["環境部化學物質管理署", "權責"],
    },
    {
      ref: "C006",
      statement: "工作場所的氫氟酸暴露管制屬勞動部職業安全衛生署的權責。",
      subject: "工作場所暴露管制",
      predicate: "權責機關為",
      object: "勞動部職業安全衛生署",
      proposition_types: ["domestic_policy"],
      risk_level: "low",
      conditions: { location: "工作場所" },
      source_paragraph_id: "P-004",
      source_quote:
        "工作場所的暴露管制與勞工健康保護，則屬勞動部職業安全衛生署的權責",
      status: "approved",
      tags: ["勞動部職業安全衛生署", "權責"],
    },
    {
      ref: "C007",
      statement: "大面積或高濃度暴露時，可能導致血鈣濃度下降。",
      subject: "氫氟酸大面積或高濃度暴露",
      predicate: "可能導致",
      object: "血鈣濃度下降",
      proposition_types: ["substance_property", "toxicology_mechanism"],
      risk_level: "high",
      source_paragraph_id: "P-002",
      source_quote: "大面積或高濃度暴露時，可能導致血鈣濃度下降",
      status: "needs_fix",
      quality_flags: ["condition_lost"],
      quality_score: 78,
      review_note: "敘述未帶出「暴露面積較大」這個限定條件，補齊後再核定。",
    },
    {
      ref: "C008",
      statement: "含葡萄糖酸鈣的凝膠可用於皮膚接觸後的初步處置。",
      subject: "葡萄糖酸鈣凝膠",
      predicate: "可用於",
      object: "皮膚接觸後的初步處置",
      proposition_types: ["health_advice", "toxicology_mechanism"],
      risk_level: "medium",
      source_paragraph_id: "P-003",
      source_quote: "含葡萄糖酸鈣的凝膠可用於皮膚接觸後的初步處置",
      status: "needs_fix",
      quality_flags: ["condition_lost"],
      quality_score: 74,
      review_note:
        "原文強調「仍需由醫療人員評估」，這句單獨呈現會被讀成可自行處理。",
    },
    {
      ref: "C009",
      statement: "氫氟酸是劇毒物質，只要碰到一滴就會致命。",
      subject: "氫氟酸",
      predicate: "是",
      object: "碰到一滴就致命的劇毒物質",
      proposition_types: ["substance_property"],
      risk_level: "high",
      source_paragraph_id: "P-002",
      source_quote: "造成組織深層損傷",
      status: "rejected",
      quality_flags: ["certainty_escalated", "inference_suspected"],
      quality_score: 35,
      review_note:
        "原文沒有「一滴致命」的敘述，且把有條件的全身性影響寫成必然結果。",
    },
    {
      ref: "C010",
      statement: "家用清潔劑都含有氫氟酸，使用時非常危險。",
      subject: "家用清潔劑",
      predicate: "都含有",
      object: "氫氟酸",
      proposition_types: ["substance_property"],
      risk_level: "high",
      source_paragraph_id: "P-005",
      source_quote: "部分除鏽劑或清潔劑含有氟化物成分",
      status: "rejected",
      quality_flags: ["number_mismatch", "certainty_escalated"],
      quality_score: 30,
      review_note: "原文寫的是「部分」且是「氟化物成分」，不是「都含有氫氟酸」。",
    },
    {
      ref: "C011",
      statement: "眼睛接觸氫氟酸時應持續沖洗並立即送醫。",
      subject: "眼睛接觸氫氟酸",
      predicate: "應",
      object: "持續沖洗並立即送醫",
      proposition_types: ["health_advice"],
      risk_level: "high",
      conditions: { exposure_route: "眼睛接觸" },
      source_paragraph_id: "P-003",
      source_quote: "眼睛接觸時應持續沖洗並立即送醫",
      status: "pending",
    },
    {
      ref: "C012",
      statement: "氫氟酸在半導體製造與玻璃蝕刻等工業製程中使用。",
      subject: "氫氟酸",
      predicate: "使用於",
      object: "半導體製造與玻璃蝕刻等工業製程",
      proposition_types: ["agency_topic"],
      risk_level: "low",
      source_paragraph_id: "P-001",
      source_quote: "在半導體製造、玻璃蝕刻與金屬表面清洗等工業製程中使用",
      status: "pending",
    },
  ],
};

const MERCURY: DemoArticle = {
  slug: "mercury",
  title: "示範：汞與甲基汞的暴露途徑",
  originUrl: "https://demo.local/cha/mercury",
  topic: "甲基汞的暴露途徑與飲食建議",
  paragraphs: [
    {
      paragraph_id: "P-001",
      position: 1,
      heading_path: ["汞的形態"],
      text: "汞在常溫下是液態金屬，會緩慢揮發成汞蒸氣。汞蒸氣無色無味，主要經由呼吸道進入人體。不同形態的汞，暴露途徑與健康影響並不相同。",
    },
    {
      paragraph_id: "P-002",
      position: 2,
      heading_path: ["甲基汞從哪裡來"],
      text: "甲基汞是汞在環境中經微生物作用形成的有機汞化合物，會沿食物鏈累積。大型掠食性魚類體內的甲基汞濃度，通常高於小型魚類。",
    },
    {
      paragraph_id: "P-003",
      position: 3,
      heading_path: ["誰要特別注意"],
      text: "甲基汞可以通過胎盤，胎兒的神經系統對甲基汞較為敏感。國際間的飲食建議通常針對孕婦、哺乳中的婦女與幼兒，限制大型魚類的攝取頻率，而不是要求完全不吃魚。魚類同時是優質蛋白質與必需脂肪酸的來源。",
    },
    {
      paragraph_id: "P-004",
      position: 4,
      heading_path: ["歷史事件"],
      text: "水俁病是甲基汞污染造成的中毒事件，當地居民因長期攝食受污染的魚貝類，出現以中樞神經損害為主的症狀。",
    },
    {
      paragraph_id: "P-005",
      position: 5,
      heading_path: ["家中的汞"],
      text: "含汞體溫計或血壓計破損時，不應使用吸塵器清理，以免汞蒸氣擴散。應開窗通風，並依廢棄物相關規定處理。",
    },
  ],
  candidates: [
    {
      ref: "C001",
      statement: "汞在常溫下是液態金屬，會緩慢揮發成汞蒸氣。",
      subject: "汞",
      predicate: "在常溫下",
      object: "是會緩慢揮發成汞蒸氣的液態金屬",
      proposition_types: ["substance_property"],
      risk_level: "low",
      source_paragraph_id: "P-001",
      source_quote: "汞在常溫下是液態金屬，會緩慢揮發成汞蒸氣",
      status: "approved",
      tags: ["汞", "化學性質"],
    },
    {
      ref: "C002",
      statement: "汞蒸氣主要經由呼吸道進入人體。",
      subject: "汞蒸氣",
      predicate: "主要進入途徑為",
      object: "呼吸道",
      proposition_types: ["substance_property", "toxicology_mechanism"],
      risk_level: "medium",
      conditions: { exposure_route: "吸入" },
      source_paragraph_id: "P-001",
      source_quote: "主要經由呼吸道進入人體",
      status: "approved",
      tags: ["汞蒸氣", "暴露途徑"],
    },
    {
      ref: "C003",
      statement: "甲基汞會沿食物鏈累積。",
      subject: "甲基汞",
      predicate: "會",
      object: "沿食物鏈累積",
      proposition_types: ["substance_property", "toxicology_mechanism"],
      risk_level: "medium",
      source_paragraph_id: "P-002",
      source_quote: "會沿食物鏈累積",
      status: "approved",
      tags: ["甲基汞", "食物鏈"],
    },
    {
      ref: "C004",
      statement: "大型掠食性魚類體內的甲基汞濃度，通常高於小型魚類。",
      subject: "大型掠食性魚類",
      predicate: "體內甲基汞濃度通常高於",
      object: "小型魚類",
      proposition_types: ["substance_property"],
      risk_level: "medium",
      source_paragraph_id: "P-002",
      source_quote: "大型掠食性魚類體內的甲基汞濃度，通常高於小型魚類",
      status: "approved",
      tags: ["甲基汞", "魚類"],
    },
    {
      ref: "C005",
      statement: "胎兒的神經系統對甲基汞較為敏感。",
      subject: "胎兒神經系統",
      predicate: "對甲基汞",
      object: "較為敏感",
      proposition_types: ["toxicology_mechanism"],
      risk_level: "high",
      conditions: { population: "胎兒" },
      source_paragraph_id: "P-003",
      source_quote: "胎兒的神經系統對甲基汞較為敏感",
      status: "approved",
      tags: ["甲基汞", "胎兒"],
    },
    {
      ref: "C006",
      statement:
        "國際間的飲食建議通常針對孕婦、哺乳中的婦女與幼兒，限制大型魚類的攝取頻率，而不是要求完全不吃魚。",
      subject: "國際飲食建議",
      predicate: "針對特定族群限制",
      object: "大型魚類的攝取頻率",
      proposition_types: ["foreign_policy", "health_advice"],
      risk_level: "medium",
      conditions: { population: "孕婦、哺乳中的婦女與幼兒" },
      source_paragraph_id: "P-003",
      source_quote:
        "國際間的飲食建議通常針對孕婦、哺乳中的婦女與幼兒，限制大型魚類的攝取頻率，而不是要求完全不吃魚",
      status: "approved",
      tags: ["飲食建議", "孕婦"],
    },
    {
      ref: "C007",
      statement: "甲基汞可以通過胎盤。",
      subject: "甲基汞",
      predicate: "可以通過",
      object: "胎盤",
      proposition_types: ["toxicology_mechanism"],
      risk_level: "high",
      source_paragraph_id: "P-003",
      source_quote: "甲基汞可以通過胎盤",
      status: "needs_fix",
      quality_flags: ["condition_lost"],
      quality_score: 80,
      review_note: "建議與「胎兒神經系統較敏感」合併，單獨呈現讀者不易理解其意義。",
    },
    {
      ref: "C008",
      statement: "含汞體溫計破損時不應使用吸塵器清理。",
      subject: "含汞體溫計破損",
      predicate: "不應使用",
      object: "吸塵器清理",
      proposition_types: ["health_advice"],
      risk_level: "medium",
      source_paragraph_id: "P-005",
      source_quote: "不應使用吸塵器清理",
      status: "needs_fix",
      quality_flags: ["incomplete_subject"],
      quality_score: 72,
      review_note: "原文同時包含血壓計，主詞需要補完整。",
    },
    {
      ref: "C009",
      statement: "吃魚會導致汞中毒，孕婦絕對不能吃魚。",
      subject: "孕婦",
      predicate: "絕對不能",
      object: "吃魚",
      proposition_types: ["toxicology_mechanism", "health_advice"],
      risk_level: "high",
      source_paragraph_id: "P-003",
      source_quote: "限制大型魚類的攝取頻率",
      status: "rejected",
      quality_flags: ["certainty_escalated", "inference_suspected"],
      quality_score: 25,
      review_note: "原文明確寫「而不是要求完全不吃魚」，這句與原文相反。",
    },
    {
      ref: "C010",
      statement: "水俁病證明所有海鮮都含有危險劑量的甲基汞。",
      subject: "水俁病",
      predicate: "證明",
      object: "所有海鮮都含有危險劑量的甲基汞",
      proposition_types: ["event"],
      risk_level: "high",
      source_paragraph_id: "P-004",
      source_quote: "當地居民因長期攝食受污染的魚貝類",
      status: "rejected",
      quality_flags: ["inference_suspected", "multi_proposition"],
      quality_score: 22,
      review_note: "原文限定在「受污染的」魚貝類與特定地區，不能外推到所有海鮮。",
    },
    {
      ref: "C011",
      statement:
        "水俁病是甲基汞污染造成的中毒事件，當地居民出現以中樞神經損害為主的症狀。",
      subject: "水俁病",
      predicate: "是",
      object: "甲基汞污染造成的中毒事件",
      proposition_types: ["event"],
      risk_level: "medium",
      source_paragraph_id: "P-004",
      source_quote: "水俁病是甲基汞污染造成的中毒事件",
      status: "pending",
    },
    {
      ref: "C012",
      statement: "魚類是優質蛋白質與必需脂肪酸的來源。",
      subject: "魚類",
      predicate: "是",
      object: "優質蛋白質與必需脂肪酸的來源",
      proposition_types: ["health_advice"],
      risk_level: "low",
      source_paragraph_id: "P-003",
      source_quote: "魚類同時是優質蛋白質與必需脂肪酸的來源",
      status: "pending",
    },
  ],
};

const SUDAN_RED: DemoArticle = {
  slug: "sudan-red",
  title: "示範：蘇丹紅與食品違法添加",
  originUrl: "https://demo.local/cha/sudan-red",
  topic: "蘇丹紅為什麼不得用於食品",
  paragraphs: [
    {
      paragraph_id: "P-001",
      position: 1,
      heading_path: ["蘇丹紅是什麼"],
      text: "蘇丹紅是一類偶氮染料的統稱，包括蘇丹紅一號至四號。它們原本的用途是溶劑、油、蠟與鞋油等工業產品的著色。",
    },
    {
      paragraph_id: "P-002",
      position: 2,
      heading_path: ["為什麼不能加在食品裡"],
      text: "蘇丹紅不得作為食品添加物使用。國際癌症研究機構將蘇丹紅一號列為第3類，表示現有證據不足以判定其對人類的致癌性；分類本身不等於在實際暴露下必然造成健康危害。",
    },
    {
      paragraph_id: "P-003",
      position: 3,
      heading_path: ["為什麼會在食品中被驗出"],
      text: "食品中被檢出蘇丹紅，通常來自非法添加或原料污染，較常見於辣椒粉、咖哩粉等香辛料製品。",
    },
    {
      paragraph_id: "P-004",
      position: 4,
      heading_path: ["誰在管"],
      text: "食品添加物的准用範圍與食品中的殘留管理，屬衛生福利部食品藥物管理署的權責。",
    },
    {
      paragraph_id: "P-005",
      position: 5,
      heading_path: ["消費者能做什麼"],
      text: "消費者無法用肉眼判斷產品是否含有蘇丹紅。主管機關的市售抽驗與邊境查驗，是主要的把關方式。",
    },
  ],
  candidates: [
    {
      ref: "C001",
      statement: "蘇丹紅是一類偶氮染料的統稱，包括蘇丹紅一號至四號。",
      subject: "蘇丹紅",
      predicate: "是",
      object: "一類偶氮染料的統稱",
      proposition_types: ["substance_property", "chemistry_concept"],
      risk_level: "low",
      source_paragraph_id: "P-001",
      source_quote: "蘇丹紅是一類偶氮染料的統稱，包括蘇丹紅一號至四號",
      status: "approved",
      tags: ["蘇丹紅", "偶氮染料"],
    },
    {
      ref: "C002",
      statement: "蘇丹紅原本的用途是溶劑、油、蠟與鞋油等工業產品的著色。",
      subject: "蘇丹紅",
      predicate: "原本用途為",
      object: "工業產品的著色",
      proposition_types: ["agency_topic"],
      risk_level: "low",
      source_paragraph_id: "P-001",
      source_quote: "原本的用途是溶劑、油、蠟與鞋油等工業產品的著色",
      status: "approved",
      tags: ["蘇丹紅", "工業用途"],
    },
    {
      ref: "C003",
      statement: "蘇丹紅不得作為食品添加物使用。",
      subject: "蘇丹紅",
      predicate: "不得作為",
      object: "食品添加物",
      proposition_types: ["domestic_policy"],
      risk_level: "medium",
      source_paragraph_id: "P-002",
      source_quote: "蘇丹紅不得作為食品添加物使用",
      status: "approved",
      tags: ["蘇丹紅", "食品添加物"],
    },
    {
      ref: "C004",
      statement:
        "國際癌症研究機構將蘇丹紅一號列為第3類，表示現有證據不足以判定其對人類的致癌性。",
      subject: "國際癌症研究機構",
      predicate: "將蘇丹紅一號列為",
      object: "第3類",
      proposition_types: ["foreign_policy", "research_literature"],
      risk_level: "medium",
      source_paragraph_id: "P-002",
      source_quote:
        "國際癌症研究機構將蘇丹紅一號列為第3類，表示現有證據不足以判定其對人類的致癌性",
      status: "approved",
      tags: ["國際癌症研究機構", "致癌性分類"],
    },
    {
      ref: "C005",
      statement:
        "食品中被檢出蘇丹紅，通常來自非法添加或原料污染，較常見於辣椒粉、咖哩粉等香辛料製品。",
      subject: "食品中檢出的蘇丹紅",
      predicate: "通常來自",
      object: "非法添加或原料污染",
      proposition_types: ["agency_topic"],
      risk_level: "medium",
      source_paragraph_id: "P-003",
      source_quote:
        "通常來自非法添加或原料污染，較常見於辣椒粉、咖哩粉等香辛料製品",
      status: "approved",
      tags: ["蘇丹紅", "香辛料"],
    },
    {
      ref: "C006",
      statement:
        "食品添加物的准用範圍與食品中的殘留管理，屬衛生福利部食品藥物管理署的權責。",
      subject: "食品添加物准用範圍與殘留管理",
      predicate: "權責機關為",
      object: "衛生福利部食品藥物管理署",
      proposition_types: ["domestic_policy"],
      risk_level: "low",
      source_paragraph_id: "P-004",
      source_quote:
        "食品添加物的准用範圍與食品中的殘留管理，屬衛生福利部食品藥物管理署的權責",
      status: "approved",
      tags: ["衛生福利部食品藥物管理署", "權責"],
    },
    {
      ref: "C007",
      statement: "分類本身不等於在實際暴露下必然造成健康危害。",
      subject: "致癌性分類",
      predicate: "不等於",
      object: "實際暴露下必然造成健康危害",
      proposition_types: ["chemistry_concept"],
      risk_level: "medium",
      source_paragraph_id: "P-002",
      source_quote: "分類本身不等於在實際暴露下必然造成健康危害",
      status: "needs_fix",
      quality_flags: ["incomplete_subject"],
      quality_score: 70,
      review_note: "主詞是指代詞，需要補上「國際癌症研究機構的致癌性分類」。",
    },
    {
      ref: "C008",
      statement: "消費者無法用肉眼判斷產品是否含有蘇丹紅。",
      subject: "消費者",
      predicate: "無法用肉眼判斷",
      object: "產品是否含有蘇丹紅",
      proposition_types: ["agency_topic"],
      risk_level: "low",
      source_paragraph_id: "P-005",
      source_quote: "消費者無法用肉眼判斷產品是否含有蘇丹紅",
      status: "needs_fix",
      quality_flags: ["condition_lost"],
      quality_score: 76,
      review_note:
        "建議與「抽驗與邊境查驗是主要把關方式」一起呈現，避免只留下無力感。",
    },
    {
      ref: "C009",
      statement: "蘇丹紅是致癌物，吃到含蘇丹紅的食品就會得癌症。",
      subject: "蘇丹紅",
      predicate: "是",
      object: "吃到就會得癌症的致癌物",
      proposition_types: ["substance_property", "toxicology_mechanism"],
      risk_level: "high",
      source_paragraph_id: "P-002",
      source_quote: "國際癌症研究機構將蘇丹紅一號列為第3類",
      status: "rejected",
      quality_flags: ["certainty_escalated", "inference_suspected"],
      quality_score: 20,
      review_note: "第3類的意思是證據不足以判定，原文也明說分類不等於必然危害。",
    },
    {
      ref: "C010",
      statement: "所有辣椒粉都含有蘇丹紅。",
      subject: "辣椒粉",
      predicate: "都含有",
      object: "蘇丹紅",
      proposition_types: ["substance_property"],
      risk_level: "high",
      source_paragraph_id: "P-003",
      source_quote: "較常見於辣椒粉、咖哩粉等香辛料製品",
      status: "rejected",
      quality_flags: ["number_mismatch", "certainty_escalated"],
      quality_score: 18,
      review_note: "原文說的是「較常見於」某類製品，不是「所有」都含有。",
    },
    {
      ref: "C011",
      statement: "主管機關的市售抽驗與邊境查驗是主要的把關方式。",
      subject: "市售抽驗與邊境查驗",
      predicate: "是",
      object: "主要的把關方式",
      proposition_types: ["domestic_policy"],
      risk_level: "low",
      source_paragraph_id: "P-005",
      source_quote: "主管機關的市售抽驗與邊境查驗，是主要的把關方式",
      status: "pending",
    },
    {
      ref: "C012",
      statement: "蘇丹紅包括蘇丹紅一號至四號。",
      subject: "蘇丹紅",
      predicate: "包括",
      object: "蘇丹紅一號至四號",
      proposition_types: ["substance_property"],
      risk_level: "low",
      source_paragraph_id: "P-001",
      source_quote: "包括蘇丹紅一號至四號",
      status: "pending",
    },
  ],
};

export const DEMO_ARTICLES: DemoArticle[] = [HYDROFLUORIC, MERCURY, SUDAN_RED];

/** 每篇示範文章要產製的素材（工作單第 22 節）。 */
export const DEMO_DRAFT_TYPES = ["faq", "explainer", "video_60s"] as const;

/** 轉成文章包格式，走與一般匯入完全相同的驗證與匯入路徑。 */
export function toArticlePack(article: DemoArticle): Record<string, unknown> {
  const approved = article.candidates.filter(
    (candidate) => candidate.status === "approved",
  );

  return {
    export_meta: {
      format: "CHA-database-aligned-export",
      format_version: 2,
      document_id: article.slug,
      human_review: "completed",
      note: "CHA 內建示範資料，內容為自行撰寫。",
    },
    sources: [
      {
        title: article.title,
        source_type: "url",
        origin_url: article.originUrl,
        mime_type: "text/html",
      },
    ],
    source_versions: [{ version: 1, parser_version: "demo/1.0" }],
    document_chunks: article.paragraphs.map((paragraph) => ({
      paragraph_id: paragraph.paragraph_id,
      position: paragraph.position,
      block_type: "paragraph",
      heading_path: paragraph.heading_path,
      text: paragraph.text,
    })),
    candidate_facts: article.candidates.map((candidate) => ({
      ref: candidate.ref,
      statement: candidate.statement,
      subject: candidate.subject,
      predicate: candidate.predicate,
      object: candidate.object,
      proposition_types: candidate.proposition_types,
      risk_level: candidate.risk_level,
      conditions: candidate.conditions ?? {},
      source_paragraph_id: candidate.source_paragraph_id,
      source_quote: candidate.source_quote,
      status: candidate.status,
      quality_flags: candidate.quality_flags ?? [],
      quality_score: candidate.quality_score ?? 100,
      review_note: candidate.review_note ?? null,
      confidence: 0.8,
      extraction_batch: `demo-${article.slug}`,
    })),
    review_records: article.candidates
      .filter((candidate) => candidate.status !== "pending")
      .map((candidate) => ({
        candidate_fact_id: `$candidate_facts[${candidate.ref}].id`,
        action:
          candidate.status === "approved"
            ? "approve"
            : candidate.status === "rejected"
              ? "reject"
              : "needs_fix",
        from_status: "pending",
        to_status: candidate.status,
        note: candidate.review_note ?? "示範資料的人工審核決定",
      })),
    knowledge_facts: approved.map((candidate, index) => ({
      ref: `F${String(index + 1).padStart(3, "0")}`,
      candidate_fact_id: `$candidate_facts[${candidate.ref}].id`,
      statement: candidate.statement,
      tags: candidate.tags ?? [],
    })),
    processing_jobs: [],
  };
}
