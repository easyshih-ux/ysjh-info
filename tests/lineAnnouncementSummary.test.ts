import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { copyLineAnnouncement, createLineAnnouncementSummary, formatLineDate } from "../lib/lineAnnouncementSummary.ts";
import { getPublicSiteUrl } from "../lib/siteUrl.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const complete = mockAnnouncements[0];

test("V2 第一行只顯示通知等級，舊公告無等級時為一般公告", () => {
  const legacy = createLineAnnouncementSummary({ ...complete, lineNotificationLevel: undefined }, "https://school.example/", 2026);
  assert.equal(legacy.split("\n")[0], "🔵【一般公告】");
  const labels = { schoolwide: "🚨【全校必讀】", required: "🔴【重要必讀】", task: "🟠【待辦事項】", general: "🔵【一般公告】" } as const;
  for (const [level, label] of Object.entries(labels)) {
    const summary = createLineAnnouncementSummary({ ...complete, lineNotificationLevel: level as keyof typeof labels }, "https://school.example/", 2026);
    assert.equal(summary.split("\n")[0], label);
  }
});

test("V2 顯示完整處室組別名稱、標題與人類可讀 audiences", () => {
  const summary = createLineAnnouncementSummary(complete, "https://school.example/", 2026);
  assert.match(summary, /📢 教務處設備組公告/);
  assert.match(summary, new RegExp(`📌 ${complete.title}`));
  assert.match(summary, /👥 對象｜七年級導師、八年級導師、全校教師/);
  assert.match(createLineAnnouncementSummary({ ...complete, department: "人事室" }, "https://school.example/", 2026), /📢 人事室公告/);
});

test("V2 優先顯示實際辦理對象，未填寫才顯示 audiences", () => {
  const summary = createLineAnnouncementSummary({ ...complete, audienceNote: "尚未完成設定的同仁" }, "https://school.example/", 2026);
  assert.match(summary, /👥 對象｜尚未完成設定的同仁/);
  assert.doesNotMatch(summary, /七年級導師、八年級導師/);
  assert.match(createLineAnnouncementSummary({ ...complete, audienceNote: "  " }, "https://school.example/", 2026), /👥 對象｜七年級導師/);
});

test("importantEvents 單筆精簡一行、多筆全部保留，空陣列時整區不顯示", () => {
  const single = createLineAnnouncementSummary({ ...complete, importantEvents: [{ date: "2026-09-18", time: "07:52", title: "晨讀公播" }] }, "https://school.example/", 2026);
  assert.match(single, /📅 日期｜9\/18 07:52 晨讀公播/);
  const multiple = createLineAnnouncementSummary({ ...complete, importantEvents: [{ date: "2026-09-18", title: "A" }, { date: "2026-09-19", title: "B" }, { date: "2026-09-20", title: "C" }] }, "https://school.example/", 2026);
  assert.match(multiple, /📅 重要日期\n・9\/18 A\n・9\/19 B\n・9\/20 C/);
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, importantEvents: [] }, "https://school.example/", 2026), /📅/);
});

test("importantEvents 日期區間顯示開始與結束日期", () => {
  const summary = createLineAnnouncementSummary({ ...complete, importantEvents: [{ date: "2026-09-18", endDate: "2026-09-20", title: "跨日活動" }] }, "https://school.example/", 2026);
  assert.match(summary, /9\/18 ～ 9\/20 跨日活動/);
});

test("LINE 摘要顯示重要事項同日與跨日起訖時間", () => {
  const sameDay = createLineAnnouncementSummary({ ...complete, importantEvents: [{ date: "2026-09-23", time: "08:30", endTime: "10:30", title: "同日活動" }] }, "https://school.example/", 2026);
  const crossDay = createLineAnnouncementSummary({ ...complete, importantEvents: [{ date: "2026-09-23", time: "08:30", endDate: "2026-09-25", endTime: "16:00", title: "跨日活動" }] }, "https://school.example/", 2026);
  assert.match(sameDay, /9\/23 08:30－10:30 同日活動/);
  assert.match(crossDay, /9\/23 08:30 ～ 9\/25 16:00 跨日活動/);
});

test("deadlines 單筆精簡、多筆全部保留，沒有期限就不顯示", () => {
  const single = createLineAnnouncementSummary({ ...complete, deadlines: [{ date: "2026-10-23", time: "12:00", label: "完成設定" }] }, "https://school.example/", 2026);
  assert.match(single, /⏰ 截止｜10\/23 12:00 完成設定/);
  const multiple = createLineAnnouncementSummary({ ...complete, deadlines: [{ date: "2026-10-23", label: "A" }, { date: "2026-10-24", time: "16:00", label: "B" }] }, "https://school.example/", 2026);
  assert.match(multiple, /⏰ 截止\n・10\/23 A\n・10\/24 16:00 B/);
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, deadlines: [] }, "https://school.example/", 2026), /⏰/);
});

test("只有完全相同的重複日期或期限才合併", () => {
  const summary = createLineAnnouncementSummary({ ...complete, importantEvents: [], deadlines: [{ date: "2026-10-23", label: "繳交" }, { date: "2026-10-23", label: "繳交" }, { date: "2026-10-23", time: "12:00", label: "繳交" }] }, "https://school.example/", 2026);
  assert.match(summary, /⏰ 截止\n・10\/23 繳交\n・10\/23 12:00 繳交(\n|$)/);
  assert.equal(summary.match(/・10\/23 繳交\n/g)?.length, 1);
});

test("通知等級對應固定提醒句，一般公告不加提醒句", () => {
  const base = { ...complete, deadlines: [] };
  assert.match(createLineAnnouncementSummary({ ...base, lineNotificationLevel: "schoolwide" }, "https://school.example/", 2026), /⚠️ 請全校同仁務必詳閱。/);
  assert.match(createLineAnnouncementSummary({ ...base, lineNotificationLevel: "required" }, "https://school.example/", 2026), /⚠️ 請相關同仁務必詳閱並依公告辦理。/);
  assert.match(createLineAnnouncementSummary({ ...complete, lineNotificationLevel: "task" }, "https://school.example/", 2026), /⚠️ 請相關同仁於期限內完成。/);
  assert.doesNotMatch(createLineAnnouncementSummary({ ...base, lineNotificationLevel: "general" }, "https://school.example/", 2026), /⚠️/);
});

test("LINE 摘要沿用聯絡資料以精簡洽詢格式輸出，舊公告不輸出", () => {
  const withContact = createLineAnnouncementSummary({ ...complete, contact: { department: "資訊組", extension: "103" } }, "https://school.example/", 2026);
  assert.match(withContact, /☎ 洽詢｜資訊組，分機 103/);
  assert.ok(withContact.indexOf("☎ 洽詢") < withContact.indexOf("👉 "));
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, contact: undefined }, "https://school.example/", 2026), /☎/);
});

test("LINE V2 純文字不使用 Markdown 語法", () => {
  const summary = createLineAnnouncementSummary({ ...complete, lineNotificationLevel: "required", contact: { department: "資訊組", extension: "103" } }, "https://school.example/", 2026);
  assert.doesNotMatch(summary, /\*\*|__|^#|\[[^\]]+\]\(/m);
});

test("日期無 time 只顯示日期，有 time 顯示日期加時間，跨年顯示年份", () => {
  assert.equal(formatLineDate("2026-09-25", undefined, 2026), "9/25");
  assert.equal(formatLineDate("2026-09-25", "07:50", 2026), "9/25 07:50");
  assert.equal(formatLineDate("2027-01-03", "16:00", 2026), "2027/1/3 16:00");
});

test("摘要不包含完整 content、attachment URL 或 followUp 內容", () => {
  const summary = createLineAnnouncementSummary(complete, "https://school.example/", 2026);
  assert.ok(!summary.includes(complete.content));
  assert.ok(!summary.includes(complete.attachments[0].url));
  assert.ok(!summary.includes(complete.followUps[0].message));
});

test("保留主要操作連結，沒有 primary link 時不產生空白區塊", () => {
  const summary = createLineAnnouncementSummary(complete, "https://school.example/", 2026);
  assert.match(summary, /👉 七年級閱讀調查表\nhttps:\/\/forms\.google\.com\//);
  assert.ok(!summary.includes(complete.links[1].url));
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, links: [] }, "https://school.example/", 2026), /👉/);
});

test("網站首頁連結集中取得並正確加入摘要", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;

  try {
    assert.equal(
      getPublicSiteUrl("https://school.example/manage?x=1#top"),
      "https://school.example/"
    );
    assert.match(
      createLineAnnouncementSummary(complete, "https://school.example/", 2026),
      new RegExp(`🔗 完整公告及操作說明：\\nhttps://school\\.example/\\?announcement=${complete.id}$`)
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});
test("GitHub Project Pages 網址保留 repository base path", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://easyshih-ux.github.io/ysjh-info/?source=test#top";
  try {
    assert.equal(getPublicSiteUrl(), "https://easyshih-ux.github.io/ysjh-info/");
    assert.match(
      createLineAnnouncementSummary({ ...complete, id: "abc123" }, getPublicSiteUrl(), 2026),
      /🔗 完整公告及操作說明：\nhttps:\/\/easyshih-ux\.github\.io\/ysjh-info\/\?announcement=abc123$/
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("Clipboard 成功與失敗都回傳狀態且不拋出例外", async () => {
  let copied = "";
  assert.equal(await copyLineAnnouncement("摘要", { writeText: async value => { copied = value; } }), true);
  assert.equal(copied, "摘要");
  assert.equal(await copyLineAnnouncement("摘要", { writeText: async () => { throw new Error("blocked"); } }), false);
  assert.equal(await copyLineAnnouncement("摘要", undefined), false);
});

test("publish 成功保留正式 announcement snapshot，manage 使用同一摘要元件", () => {
  const publishPage = source("app/publish/page.tsx");
  const manageDetails = source("app/manage/announcement-details.tsx");
  assert.match(publishPage, /setPublishedAnnouncement\(announcement\)/);
  assert.match(publishPage, /<LineSummaryCard announcement=\{publishedAnnouncement\}/);
  assert.match(manageDetails, /<LineSummaryCard announcement=\{item\}/);
});

test("複製為純 client-side，不修改 Firestore 或 updatedAt", () => {
  const component = source("components/line-summary-card.tsx");
  const helper = source("lib/lineAnnouncementSummary.ts");
  const combined = `${component}\n${helper}`;
  assert.match(combined, /navigator\.clipboard|writeText/);
  assert.doesNotMatch(combined, /updateDoc|setDoc|addDoc|updatedAt|firebase/);
  assert.match(component, /已複製，可直接貼到 LINE 群組。/);
  assert.match(component, /複製失敗，請手動選取文字複製。/);
});

test("V2 完整範例格式與段落順序", () => {
  const summary = createLineAnnouncementSummary({
    ...complete,
    id: "2fa",
    department: "資訊組",
    title: "校務行政系統「雙因子驗證」設定",
    lineNotificationLevel: "required",
    audienceNote: "尚未完成設定的同仁",
    importantEvents: [],
    deadlines: [{ date: "2026-10-23", time: "12:00", label: "完成設定" }],
    contact: { department: "資訊組", extension: "103" },
    links: [],
  }, "https://easyshih-ux.github.io/ysjh-info/", 2026);
  assert.equal(summary, [
    "🔴【重要必讀】",
    "📢 教務處資訊組公告",
    "📌 校務行政系統「雙因子驗證」設定",
    "👥 對象｜尚未完成設定的同仁",
    "⏰ 截止｜10/23 12:00 完成設定",
    "⚠️ 請相關同仁務必詳閱並依公告辦理。",
    "☎ 洽詢｜資訊組，分機 103",
    "🔗 完整公告及操作說明：\nhttps://easyshih-ux.github.io/ysjh-info/?announcement=2fa",
  ].join("\n\n"));
});
