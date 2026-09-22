import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { copyLineAnnouncement, createLineAnnouncementSummary, formatLineDate } from "../lib/lineAnnouncementSummary.ts";
import { getPublicSiteUrl } from "../lib/siteUrl.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const complete = mockAnnouncements[0];

test("摘要包含 department、完整 title 與人類可讀 audiences", () => {
  const summary = createLineAnnouncementSummary(complete, "https://school.example/", 2026);
  assert.match(summary, /📢【設備組公告】/);
  assert.match(summary, new RegExp(complete.title));
  assert.match(summary, /👥 對象：七年級導師、八年級導師、全校教師/);
});

test("importantEvents 有資料顯示，空陣列時整區不顯示", () => {
  assert.match(createLineAnnouncementSummary(complete, "https://school.example/", 2026), /📅 重要日期：[\s\S]*・9\/18 07:52 晨讀公播/);
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, importantEvents: [] }, "https://school.example/", 2026), /📅 重要日期：/);
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

test("deadlines 有資料顯示，空陣列時整區不顯示", () => {
  assert.match(createLineAnnouncementSummary(complete, "https://school.example/", 2026), /⏰ 截止：[\s\S]*・9\/18 16:00 七年級閱讀調查表繳交截止/);
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, deadlines: [] }, "https://school.example/", 2026), /⏰ 截止：/);
});

test("LINE 摘要使用共用 formatter 輸出聯絡資訊，舊公告不輸出", () => {
  const withContact = createLineAnnouncementSummary({ ...complete, contact: { department: "設備組", extension: "104" } }, "https://school.example/", 2026);
  assert.match(withContact, /☎ 如有任何疑問，請洽設備組，分機 104。/);
  assert.ok(withContact.indexOf("☎ 如有任何疑問") < withContact.indexOf("🔗 主要連結"));
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, contact: undefined }, "https://school.example/", 2026), /☎ 如有任何疑問/);
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

test("只顯示主要連結，沒有 primary link 時不產生空白區塊", () => {
  const summary = createLineAnnouncementSummary(complete, "https://school.example/", 2026);
  assert.match(summary, /🔗 主要連結：七年級閱讀調查表\nhttps:\/\/forms\.google\.com\//);
  assert.ok(!summary.includes(complete.links[1].url));
  assert.doesNotMatch(createLineAnnouncementSummary({ ...complete, links: [] }, "https://school.example/", 2026), /🔗 主要連結：/);
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
      /🔎 完整公告、附件及最新補充請至「義學公務資訊站」查看：\nhttps:\/\/school\.example\/$/
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
  const managePage = source("app/manage/page.tsx");
  assert.match(publishPage, /setPublishedAnnouncement\(announcement\)/);
  assert.match(publishPage, /<LineSummaryCard announcement=\{publishedAnnouncement\}/);
  assert.match(managePage, /<LineSummaryCard announcement=\{item\}/);
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
