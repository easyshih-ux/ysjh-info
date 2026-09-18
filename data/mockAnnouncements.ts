import type { Announcement } from "@/lib/announcements";

// Dates intentionally surround the prototype's fixed demo day (2026-09-18).
export const DEMO_NOW = new Date("2026-09-18T10:00:00+08:00");

export const mockAnnouncements: Announcement[] = [
  {
    id: "ann-001", academicYear: 115, publishedAt: "2026-09-18T08:10:00+08:00", department: "設備組",
    title: "九月份晨讀與班級書箱輪替通知", audiences: ["七年級導師", "八年級導師", "全校教師"],
    content: "各位老師您好：\n\n九月份晨讀及班級書箱輪替安排如下：\n1. 請導師提醒學生於指定時間將書箱送至圖書館前走廊。\n2. 書箱內圖書請依編號順序放置，如有遺失或破損請另紙註記。\n3. 週五晨讀公播將介紹本月主題書展。\n\n若班級當日另有活動，請提前與設備組聯繫調整。謝謝各位老師協助。",
    importantEvents: [
      { date: "2026-09-18", time: "07:52", title: "晨讀公播" },
      { date: "2026-09-18", time: "10:30", title: "七年級贈書領取" },
      { date: "2026-09-20", title: "八年級書箱輪替" },
    ],
    deadlines: [
      { date: "2026-09-18", time: "16:00", label: "七年級閱讀調查表繳交截止" },
      { date: "2026-09-20", label: "第八節通知單繳回" },
    ],
    attachments: [
      { id: "att-001", type: "image", url: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=80", name: "九月主題書展海報", caption: "九月主題書展與晨讀活動說明" },
      { id: "att-002", type: "image", url: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1200&q=80", name: "班級書箱陳列參考", caption: "書箱輪替完成後的陳列方式參考" },
    ],
    followUps: [
      { createdAt: "2026-09-18T09:30:00+08:00", type: "reminder", message: "尚未繳交：701、705、708，請於今日 16:00 前完成。" },
      { createdAt: "2026-09-17T15:10:00+08:00", type: "supplement", message: "請七年級各班確認閱讀調查表是否已完成送出。" },
    ],
    links: [
      { id: "link-001", label: "七年級閱讀調查表", url: "https://forms.google.com/", type: "website", isPrimary: true },
      { id: "link-002", label: "九月主題書展說明", url: "https://example.edu.tw/reading", type: "website", isPrimary: false },
    ],
  },
  {
    id: "ann-002", academicYear: 115, publishedAt: "2026-09-17T15:30:00+08:00", department: "教學組",
    title: "校內公開授課觀課報名", audiences: ["專任教師", "全校教師"],
    content: "本學期第一場公開授課開放報名。\n\n授課領域：自然科學\n觀課地點：三樓自然教室\n\n請有意參加的教師於期限前完成表單，以利安排座位與觀課資料。",
    importantEvents: [{ date: "2026-09-19", time: "09:10", title: "自然科公開授課" }],
    deadlines: [
      { date: "2026-09-19", label: "公開授課觀課報名截止" },
      { date: "2026-09-22", label: "觀課回饋表繳交" },
      { date: "2026-09-23", time: "16:00", label: "教師研習報名截止" },
    ],
    attachments: [{ id: "att-003", type: "image", url: "https://images.unsplash.com/photo-1588072432836-e10032774350?auto=format&fit=crop&w=1200&q=80", name: "公開授課座位配置圖", caption: "視聽教室觀課座位配置" }],
    followUps: [{ createdAt: "2026-09-18T08:45:00+08:00", type: "reminder", message: "目前尚有 6 位教師未完成報名，請有意參加者於截止前填表。" }],
    links: [{ id: "link-003", label: "公開授課觀課報名表", url: "https://forms.google.com/", type: "website", isPrimary: true }],
  },
  {
    id: "ann-003", academicYear: 115, publishedAt: "2026-09-16T11:20:00+08:00", department: "學務處",
    title: "校園防災演練注意事項", audiences: ["七年級導師", "八年級導師", "九年級導師", "專任教師", "行政"],
    content: "本週將辦理校園防災演練。請任課教師於警報響起後，依避難三步驟引導學生就地掩護，並按指定路線疏散。\n\n各班請攜帶班級點名單，到達集合地點後立即清點人數並回報。",
    importantEvents: [{ date: "2026-09-21", time: "09:20", title: "全校防災演練" }], deadlines: [],
    attachments: [{ id: "att-004", type: "image", url: "https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=1200&q=80", name: "防災避難流程圖", caption: "疏散動線與集合位置示意" }],
    followUps: [],
    links: [{ id: "link-004", label: "校園防災演練說明", url: "https://example.edu.tw/safety", type: "website", isPrimary: false }],
  },
  {
    id: "ann-004", academicYear: 115, publishedAt: "2026-09-15T09:00:00+08:00", department: "輔導處",
    title: "親職教育講座報名與班級宣導", audiences: ["七年級導師", "八年級導師", "九年級導師"],
    content: "請各班導師協助轉知家長親職教育講座資訊，並將報名連結公告於班級群組。\n\n主題：陪孩子走過青春期\n講師：校外心理師\n地點：本校視聽教室",
    importantEvents: [{ date: "2026-09-20", time: "14:00", title: "親職教育講座" }],
    deadlines: [{ date: "2026-09-21", time: "12:00", label: "親職教育講座報名截止" }],
    attachments: [], followUps: [], links: [{ id: "link-005", label: "親職教育講座報名表", url: "https://forms.google.com/", type: "website", isPrimary: true }],
  },
  {
    id: "ann-005", academicYear: 115, publishedAt: "2026-09-14T13:40:00+08:00", department: "總務處",
    title: "教室冷氣濾網清潔與設備巡檢", audiences: ["行政", "全校教師"],
    content: "總務處將分區進行冷氣濾網清潔與用電設備巡檢。巡檢期間可能短暫進入教室，請老師協助保持設備周邊淨空。",
    importantEvents: [], deadlines: [], attachments: [], followUps: [], links: [],
  },
  {
    id: "ann-006", academicYear: 114, publishedAt: "2026-09-12T10:00:00+08:00", department: "註冊組",
    title: "第一次段考命題範圍確認", audiences: ["專任教師", "行政"],
    content: "請各科教師確認第一次段考命題範圍，並由領域召集人彙整後送交註冊組。命題資料請依校內格式編排。",
    importantEvents: [{ date: "2026-09-19", time: "13:30", title: "上學年度補考命題確認" }], deadlines: [{ date: "2026-09-25", time: "17:00", label: "段考命題範圍繳交截止" }], attachments: [], followUps: [], links: [],
  },
  {
    id: "ann-007", academicYear: 113, publishedAt: "2026-09-02T08:00:00+08:00", department: "訓育組",
    title: "教師節感恩活動照片回傳", audiences: ["七年級導師", "八年級導師", "九年級導師"],
    content: "請各班擇優回傳教師節感恩活動照片兩張，檔名請包含班級與活動名稱。此公告雖已截止，仍保留供後續查詢。",
    importantEvents: [{ date: "2026-09-10", title: "班級感恩活動" }],
    deadlines: [{ date: "2026-09-12", time: "16:00", label: "活動照片回傳截止" }],
    attachments: [],
    followUps: [{ createdAt: "2026-09-12T13:20:00+08:00", type: "reminder", message: "尚未回傳：702、804、903，請於今日 16:00 前完成。" }],
    links: [],
  },
  {
    id: "ann-008", academicYear: 115, publishedAt: "2026-09-18T16:20:00+08:00", department: "訓育組",
    title: "家長日活動流程與班級位置說明", audiences: ["七年級導師", "八年級導師", "九年級導師", "全校教師"],
    content: "各位老師您好：\n\n本學期家長日將於週日下午辦理，請導師於活動開始前完成教室環境與資料準備。\n\n1. 請於 13:30 前完成班級報到桌設置。\n2. 家長可使用手機版導航地圖查詢班級位置。\n3. 若教室臨時調整，請立即回報訓育組更新現場指引。\n\n請協助將導航網址轉知家長，並提醒家長從正門進入校園。",
    importantEvents: [{ date: "2026-09-20", time: "14:00", title: "家長日班級座談" }], deadlines: [],
    attachments: [], followUps: [],
    links: [
      { id: "link-006", label: "家長日班級導航地圖（手機版）", url: "https://easyshih-ux.github.io/parent-day-map/", type: "website", isPrimary: true },
      { id: "link-007", label: "家長日活動流程說明", url: "https://example.edu.tw/parent-day", type: "website", isPrimary: false },
    ],
  },
];
