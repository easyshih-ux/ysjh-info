import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { announcementsForIdentity, chasingAnnouncements, hasNoScheduledDates, importantNoticeAnnouncements, upcomingDeadlines, weeklyEvents, importantNoticeDayIndex, isImportantNoticeActive, IMPORTANT_NOTICE_DAYS, IMPORTANT_NOTICE_PREVIEW_LIMIT, visibleImportantNotices } from "../lib/announcementLogic.ts";
import type { Announcement, LineNotificationLevel } from "../lib/announcements.ts";
import { ACTIVITY_KEYWORDS, needsImportantDateReminder } from "../lib/publishDraft.ts";
import { ANNOUNCEMENT_OPEN_SOURCES } from "../lib/publicAnalytics.ts";
import { createLineAnnouncementSummary } from "../lib/lineAnnouncementSummary.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const taipei = (value: string) => new Date(`${value}+08:00`);
const notice = (id: string, level: LineNotificationLevel | undefined, publishedAtTaipei: string, overrides: Partial<Announcement> = {}): Announcement => ({
  ...mockAnnouncements[0],
  id,
  lineNotificationLevel: level,
  publishedAt: taipei(publishedAtTaipei).toISOString(),
  audiences: ["全校教師"],
  publicationStatus: "published",
  importantEvents: [],
  deadlines: [],
  followUps: [],
  ...overrides,
});

test("只有全校必讀與重要必讀進入重要公告，舊公告與其他等級不進入", () => {
  const now = taipei("2026-10-23T09:00:00");
  const items = [
    notice("schoolwide", "schoolwide", "2026-10-23T08:00:00"),
    notice("required", "required", "2026-10-23T08:00:00"),
    notice("task", "task", "2026-10-23T08:00:00"),
    notice("general", "general", "2026-10-23T08:00:00"),
    notice("legacy", undefined, "2026-10-23T08:00:00"),
  ];
  assert.deepEqual(importantNoticeAnnouncements(items, now).map(item => item.id), ["schoolwide", "required"]);
});

test("只有全校必讀／重要必讀且沒有活動日期、沒有繳交期限的公告進入重要公告區", () => {
  const now = taipei("2026-10-23T09:00:00");
  const event = { date: "2026-10-30", title: "說明會" };
  const deadline = { date: "2026-10-31", label: "繳交" };
  const items = [
    notice("schoolwide-plain", "schoolwide", "2026-10-23T08:00:00"),
    notice("required-plain", "required", "2026-10-23T08:00:00"),
    notice("schoolwide-event", "schoolwide", "2026-10-23T08:00:00", { importantEvents: [event] }),
    notice("schoolwide-range", "schoolwide", "2026-10-23T08:00:00", { importantEvents: [{ date: "2026-10-01", endDate: "2026-12-31", title: "持續活動" }] }),
    notice("required-deadline", "required", "2026-10-23T08:00:00", { deadlines: [deadline] }),
    notice("required-past-deadline", "required", "2026-10-23T08:00:00", { deadlines: [{ date: "2026-10-01", label: "已過期限" }] }),
    notice("required-both", "required", "2026-10-23T08:00:00", { importantEvents: [event], deadlines: [deadline] }),
    notice("task-plain", "task", "2026-10-23T08:00:00"),
    notice("general-plain", "general", "2026-10-23T08:00:00"),
    notice("legacy-plain", undefined, "2026-10-23T08:00:00"),
    notice("title-date", "required", "2026-10-23T08:00:00", { title: "10/30（五）研習通知" }),
  ];
  assert.deepEqual(importantNoticeAnnouncements(items, now).map(item => item.id), ["schoolwide-plain", "required-plain", "title-date"]);
  assert.equal(hasNoScheduledDates(notice("x", "required", "2026-10-23T08:00:00")), true, "發布日期不算活動日期");
  assert.equal(hasNoScheduledDates(notice("x", "required", "2026-10-23T08:00:00", { title: "11/2 截止" })), true, "不依標題日期文字判斷");
  assert.equal(hasNoScheduledDates(notice("x", "required", "2026-10-23T08:00:00", { deadlines: [deadline] })), false);
  const original = items.find(item => item.id === "required-deadline")!;
  assert.deepEqual(original.deadlines, [deadline], "不修改原始資料");
});

test("其他首頁區塊不受重要公告規則影響：本週事項、即將截止、催繳仍取全部公告", () => {
  const page = source("app/page.tsx");
  assert.match(page, /weeklyEvents\(regularHomepageAnnouncements, now\)/);
  assert.match(page, /nextWeekEvents\(regularHomepageAnnouncements, now\)/);
  assert.match(page, /upcomingDeadlines\(regularHomepageAnnouncements, now\)/);
  // 有日期的全校必讀公告雖不進重要公告區，仍由本週事項、即將截止、催繳呈現。
  const now = taipei("2026-10-21T09:00:00");
  const withEvent = notice("ev", "schoolwide", "2026-10-20T08:00:00", { importantEvents: [{ date: "2026-10-22", title: "全校集會" }] });
  const withDeadline = notice("dl", "required", "2026-10-20T08:00:00", { deadlines: [{ date: "2026-10-23", label: "填報" }], collectionStatus: "chasing" });
  assert.deepEqual(importantNoticeAnnouncements([withEvent, withDeadline], now), []);
  assert.ok(weeklyEvents([withEvent], now).some(item => item.announcement.id === "ev"));
  assert.ok(upcomingDeadlines([withDeadline], now).some(item => item.announcement.id === "dl"));
  assert.deepEqual(chasingAnnouncements([withDeadline]).map(item => item.id), ["dl"]);
});

test("曝光為發布當日起 7 個台北日曆天，第 8 天退出", () => {
  const item = notice("a", "required", "2026-10-23T23:30:00");
  assert.equal(IMPORTANT_NOTICE_DAYS, 7);
  assert.equal(importantNoticeDayIndex(item, taipei("2026-10-23T23:59:00")), 0);
  assert.equal(isImportantNoticeActive(item, taipei("2026-10-29T23:59:59")), true);
  assert.equal(isImportantNoticeActive(item, taipei("2026-10-30T00:00:00")), false);
  assert.equal(isImportantNoticeActive(item, taipei("2026-10-22T12:00:00")), false, "未來發布時間不顯示");
});

test("以台北日期判斷：UTC 前一天、台北當天凌晨發布算第 1 天", () => {
  const item = notice("early", "required", "2026-10-23T00:30:00");
  assert.equal(item.publishedAt, "2026-10-22T16:30:00.000Z");
  assert.equal(importantNoticeDayIndex(item, taipei("2026-10-23T08:00:00")), 0);
  assert.equal(isImportantNoticeActive(item, taipei("2026-10-29T20:00:00")), true);
  assert.equal(isImportantNoticeActive(item, taipei("2026-10-30T00:00:01")), false);
});

test("跨月與跨年的 7 天邊界正確", () => {
  const month = notice("month", "required", "2026-10-28T10:00:00");
  assert.equal(isImportantNoticeActive(month, taipei("2026-11-03T12:00:00")), true);
  assert.equal(isImportantNoticeActive(month, taipei("2026-11-04T00:00:00")), false);
  const year = notice("year", "schoolwide", "2026-12-28T10:00:00");
  assert.equal(isImportantNoticeActive(year, taipei("2027-01-03T23:59:00")), true);
  assert.equal(isImportantNoticeActive(year, taipei("2027-01-04T00:00:00")), false);
});

test("修改公告不延長曝光，下架公告不顯示", () => {
  const edited = notice("edited", "required", "2026-10-20T08:00:00", { contentUpdatedAt: taipei("2026-10-27T08:00:00").toISOString(), contentUpdateCount: 3 });
  assert.equal(isImportantNoticeActive(edited, taipei("2026-10-27T09:00:00")), false);
  const withdrawn = notice("withdrawn", "schoolwide", "2026-10-23T08:00:00", { publicationStatus: "withdrawn" });
  assert.equal(isImportantNoticeActive(withdrawn, taipei("2026-10-23T09:00:00")), false);
});

test("全校必讀優先，同等級依發布時間由新到舊", () => {
  const now = taipei("2026-10-25T09:00:00");
  const items = [
    notice("required-old", "required", "2026-10-21T08:00:00"),
    notice("schoolwide-old", "schoolwide", "2026-10-20T08:00:00"),
    notice("required-new", "required", "2026-10-24T08:00:00"),
    notice("schoolwide-new", "schoolwide", "2026-10-23T08:00:00"),
  ];
  assert.deepEqual(importantNoticeAnnouncements(items, now).map(item => item.id), ["schoolwide-new", "schoolwide-old", "required-new", "required-old"]);
});

test("已出現在催繳、本週、下週、即將截止的公告不重複顯示", () => {
  const now = taipei("2026-10-23T09:00:00");
  const items = ["a", "b", "c", "d", "e"].map(id => notice(id, "required", "2026-10-23T08:00:00"));
  assert.deepEqual(importantNoticeAnnouncements(items, now, ["a", "c", "e"]).map(item => item.id), ["b", "d"]);
});

test("依身分篩選後才判斷，不顯示其他身分的重要公告", () => {
  const now = taipei("2026-10-23T09:00:00");
  const items = [
    notice("g7", "required", "2026-10-23T08:00:00", { audiences: ["七年級導師"] }),
    notice("all", "schoolwide", "2026-10-23T08:00:00", { audiences: ["全校教師"] }),
  ];
  assert.deepEqual(importantNoticeAnnouncements(announcementsForIdentity(items, "八年級導師"), now).map(item => item.id), ["all"]);
  assert.deepEqual(importantNoticeAnnouncements(announcementsForIdentity(items, "七年級導師"), now).map(item => item.id), ["all", "g7"]);
});

test("預設最多 3 則，超過時可展開全部並收合", () => {
  assert.equal(IMPORTANT_NOTICE_PREVIEW_LIMIT, 3);
  const five = [1, 2, 3, 4, 5];
  assert.deepEqual(visibleImportantNotices(five, false), { visible: [1, 2, 3], total: 5, canExpand: true });
  assert.deepEqual(visibleImportantNotices(five, true), { visible: five, total: 5, canExpand: true });
  assert.deepEqual(visibleImportantNotices([1, 2, 3], false), { visible: [1, 2, 3], total: 3, canExpand: false });
  assert.deepEqual(visibleImportantNotices([], false), { visible: [], total: 0, canExpand: false });
});

test("首頁區塊：無資料不顯示、使用既有篩選與排除、展開收合、沿用公告開啟統計", () => {
  const page = source("app/page.tsx");
  assert.match(page, /importantNoticeAnnouncements\(homepageAnnouncements, now, \[/);
  for (const section of ["chasing.map", "events.map", "nextEvents.map", "deadlines.map"]) assert.ok(page.includes(section));
  assert.match(page, /\{importantView\.total > 0 && <section className="section important-section"/);
  assert.match(page, /重要公告・請留意/);
  assert.match(page, /openAnnouncement\(item, "important"\)/);
  assert.match(page, /aria-expanded=\{importantExpanded\}/);
  assert.match(page, /查看全部重要公告（\$\{importantView\.total\}）/);
  assert.match(page, /收合重要公告/);
  assert.ok(ANNOUNCEMENT_OPEN_SOURCES.includes("important"));
});

test("重要公告不改變 LINE V2 複製格式", () => {
  const summary = createLineAnnouncementSummary(notice("x", "required", "2026-10-23T08:00:00", { department: "資訊組", contact: undefined, links: [] }), "https://easyshih-ux.github.io/ysjh-info/", 2026);
  assert.equal(summary.split("\n")[0], "🔴【重要必讀】");
  assert.match(summary, /🔗 完整公告及操作說明：\nhttps:\/\/easyshih-ux\.github\.io\/ysjh-info\/\?announcement=x$/);
});

test("漏填提醒：關鍵字加日期、標題含活動才提醒；已填重要日期或只有期限不提醒", () => {
  const base = { title: "公告", content: "內容", importantEvents: [] };
  assert.equal(needsImportantDateReminder({ ...base, content: "訂於 10/30 下午召開導師會議" }), true);
  assert.equal(needsImportantDateReminder({ ...base, content: "11月5日舉行防災演練" }), true);
  assert.equal(needsImportantDateReminder({ ...base, content: "2026-11-05 校外教學" }), true);
  assert.equal(needsImportantDateReminder({ ...base, title: "第二次教師研習" }), true, "標題含活動，即使沒有日期也提醒");
  assert.equal(needsImportantDateReminder({ ...base, content: "歡迎參加研習" }), false, "內容有關鍵字但沒有日期");
  assert.equal(needsImportantDateReminder({ ...base, title: "調查表繳交", content: "請於 10/30 前繳回" }), false, "只有繳交期限、沒有活動內容");
  assert.equal(needsImportantDateReminder({ title: "導師會議", content: "10/30 召開", importantEvents: [{ date: "2026-10-30", title: "導師會議" }] }), false);
  assert.equal(needsImportantDateReminder({ title: "導師會議", content: "", importantEvents: [{ date: "", title: "" }] }), true, "空白的重要日期列不算已填");
  for (const keyword of ["會議", "研習", "說明會", "講座", "典禮", "演練", "活動", "座談", "工作坊", "公播", "校外教學", "參訪", "競賽"]) {
    assert.ok((ACTIVITY_KEYWORDS as readonly string[]).includes(keyword));
    assert.equal(needsImportantDateReminder({ ...base, title: `${keyword}通知` }), true, keyword);
  }
});

test("漏填提醒不阻擋：發布預覽與編輯儲存都只顯示提醒", () => {
  const publish = source("app/publish/page.tsx");
  const manage = source("app/manage/page.tsx");
  const draft = source("lib/publishDraft.ts");
  assert.match(publish, /<ImportantDateReminder show=\{needsImportantDateReminder\(preview\)\} \/>/);
  assert.match(manage, /<ImportantDateReminder show=\{needsImportantDateReminder\(editing\)\} \/>/);
  const validate = draft.slice(draft.indexOf("export function validateBasicDraft"), draft.indexOf("export function normalizeOptionalHttpUrl"));
  assert.doesNotMatch(validate, /needsImportantDateReminder/);
  assert.match(publish, /<p>填寫後顯示於首頁「本週／下週重要事項」。<\/p>/);
  assert.match(publish, /<p>填寫後顯示於首頁「即將截止」提醒。<\/p>/);
  assert.match(manage, /<p>填寫後顯示於首頁「本週／下週重要事項」。<\/p>/);
  assert.match(manage, /<p>填寫後顯示於首頁「即將截止」提醒。<\/p>/);
  assert.match(source("components/line-notification-settings.tsx"), /不改變公告接收對象。全校必讀、重要必讀於首頁提醒 7 天。/);
  const reminder = source("components/important-date-reminder.tsx");
  assert.match(reminder, /📅 是否需要填寫重要日期？/);
  assert.match(reminder, /此公告提及活動或會議，尚未填寫<b>「重要日期／活動」<\/b>。填寫後才會顯示於首頁<b>「本週／下週重要事項」<\/b>。/);
  assert.doesNotMatch(reminder, /<button|onClick/);
});
