import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LINE_NOTIFICATION_LEVEL_LABELS, resolveLineNotificationLevel } from "../lib/announcements.ts";
import { createFollowUpNoticeText } from "../lib/lineNotices.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("四種通知等級標籤與 LINE 相同；舊公告沒有等級或值不正確時顯示一般公告", () => {
  assert.deepEqual(LINE_NOTIFICATION_LEVEL_LABELS, { schoolwide: "🚨【全校必讀】", required: "🔴【重要必讀】", task: "🟠【待辦事項】", general: "🔵【一般公告】" });
  for (const value of [undefined, null, "", "urgent", 3]) assert.equal(resolveLineNotificationLevel(value), "general");
  const badge = source("components/notice-level-badge.tsx");
  assert.match(badge, /const level = resolveLineNotificationLevel\(announcement\.lineNotificationLevel\);/);
  assert.match(badge, /<span className=\{`notice-level notice-level-\$\{level\}`\}>\{LINE_NOTIFICATION_LEVEL_LABELS\[level\]\}<\/span>/);
});

test("等級標籤緊接在標題前面（同一行元素內），不放在日期、單位那一列", () => {
  const page = source("app/page.tsx");
  const expected = [
    /<span className="chase-badge">催繳中<\/span><h3 className="titled-with-level"><NoticeLevelBadge announcement=\{item\} \/>\{item\.title\}<\/h3>/,
    /<h3 className="titled-with-level"><NoticeLevelBadge announcement=\{item\} \/>\{item\.title\}<\/h3><AudienceTags values=\{item\.audiences\} \/><AnnouncementUpdateBadges announcement=\{item\} \/>/,
    /<h3 className="titled-with-level"><NoticeLevelBadge announcement=\{a\} \/>\{a\.title\}<\/h3><AudienceTags values=\{a\.audiences\} \/><AnnouncementUpdateBadges announcement=\{a\} \/>/,
    /<strong className="titled-with-level"><NoticeLevelBadge announcement=\{a\} \/>\{a\.title\}<\/strong>/,
    /<DialogTitle className="titled-with-level"><NoticeLevelBadge announcement=\{selected\} \/>\{selected\.title\}<\/DialogTitle>/,
  ];
  for (const pattern of expected) assert.match(page, pattern);
  assert.equal(page.match(/<NoticeLevelBadge /g)?.length, 7, "標題前 5 處＋本週、下週事項 2 處");
  assert.doesNotMatch(page, /important-level/, "重要公告區不再於日期列顯示等級");
  for (const meta of page.match(/<div className="announcement-meta">[\s\S]*?<\/div>/g) ?? []) assert.doesNotMatch(meta, /NoticeLevelBadge|LEVEL_LABELS/);
});

test("修正、補充、提醒標示仍在標題下方，不與等級標籤合併", () => {
  const page = source("app/page.tsx");
  assert.equal(page.match(/<\/h3><AudienceTags values=\{(?:item|a)\.audiences\} \/><AnnouncementUpdateBadges /g)?.length, 2);
  assert.doesNotMatch(source("components/announcement-update-badges.tsx"), /NoticeLevelBadge|LEVEL_LABELS/);
});

test("手機版可自然換行：標籤不換行、標題文字照常折行；搜尋結果不被 grid 撐開", () => {
  const css = source("app/globals.css");
  assert.match(css, /\.titled-with-level \.notice-level\{display:inline-block;margin-right:6px;vertical-align:\.12em;white-space:nowrap\}/);
  assert.match(css, /\.result-row \.notice-level\{display:inline-block\}/);
  for (const level of ["schoolwide", "required", "task", "general"]) assert.match(css, new RegExp(`\\.notice-level-${level}\\{`));
});

test("LINE 文字不重複加入等級：補充等通知維持原格式", () => {
  const text = createFollowUpNoticeText({ id: "a1", department: "設備組", title: "標題", deadlines: [] }, "supplement", "內容", "https://example.test/", "2026-10-23");
  assert.ok(text.startsWith("📌【公告補充】標題\n"));
  for (const label of Object.values(LINE_NOTIFICATION_LEVEL_LABELS)) assert.ok(!text.includes(label));
});

test("本週重要事項與下週預告：等級標籤獨立一行在事項名稱上方，沿用所屬公告等級", () => {
  const page = source("app/page.tsx");
  const weekly = page.slice(page.indexOf('aria-labelledby="weekly-title"'), page.indexOf('aria-labelledby="next-week-title"'));
  const next = page.slice(page.indexOf('aria-labelledby="next-week-title"'), page.indexOf('aria-labelledby="deadline-title"'));
  assert.match(weekly, /<time>\{item\.time \|\| "全天"\}<\/time><span className="event-copy"><NoticeLevelBadge announcement=\{item\.announcement\} \/><strong>\{item\.title\}<\/strong>\{display\.periodLabel && /);
  assert.match(next, /<time>\{importantEventDateLabel\(item\.date, now\)\}<\/time><span className="event-copy"><NoticeLevelBadge announcement=\{item\.announcement\} \/><strong>\{item\.title\}<\/strong><DepartmentAudienceMeta /);
  assert.equal(weekly.match(/<NoticeLevelBadge /g)?.length, 1);
  assert.equal(next.match(/<NoticeLevelBadge /g)?.length, 1);
  // 只在事項列內換行：其他區塊仍使用 titled-with-level 同一行排列，共用元件樣式不變。
  const css = source("app/globals.css");
  assert.match(css, /\.event-copy>\.notice-level\{align-self:flex-start;max-width:100%;margin-bottom:3px;white-space:nowrap\}/);
  assert.match(css, /\.event-copy>strong\{overflow-wrap:anywhere\}/);
  assert.doesNotMatch(css, /\.notice-level\{[^}]*display:block/);
  assert.doesNotMatch(css, /\.event-copy[^{]*\{[^}]*(text-overflow:ellipsis|-webkit-line-clamp)/, "事項名稱不截斷");
  // 週次與日期判斷未改動。
  assert.match(page, /weeklyEvents\(regularHomepageAnnouncements, now\)/);
  assert.match(page, /nextWeekEvents\(regularHomepageAnnouncements, now\)/);
});
