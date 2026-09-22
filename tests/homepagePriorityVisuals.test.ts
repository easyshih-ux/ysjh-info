import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("首頁三個重點區塊共用視覺系統且保留各自識別", () => {
  const page = source("app/page.tsx");
  const styles = source("app/globals.css");
  assert.match(page, /priority-section priority-weekly/);
  assert.match(page, /priority-section priority-next/);
  assert.match(page, /priority-section priority-deadline/);
  assert.match(styles, /\.priority-weekly\{[^}]*background:#f5f9fc/);
  assert.match(styles, /\.priority-next\{[^}]*background:#f8f8fc/);
  assert.match(styles, /\.priority-deadline\{[^}]*background:#fffaf3/);
});

test("本週與下週保留日期範圍及緊湊空狀態", () => {
  const page = source("app/page.tsx");
  const styles = source("app/globals.css");
  assert.match(page, /<span className="range">\{weekRange\}<\/span>/);
  assert.match(page, /<span className="range">\{nextWeekRange\}<\/span>/);
  assert.match(page, /本週暫無其他重要事項/);
  assert.match(styles, /\.priority-section\.weekly-empty\{padding-top:12px;padding-bottom:12px\}/);
});

test("重點視覺只增加呈現 class，不改首頁資料分類呼叫", () => {
  const page = source("app/page.tsx");
  assert.match(page, /weeklyEvents\(regularHomepageAnnouncements, now\)/);
  assert.match(page, /nextWeekEvents\(regularHomepageAnnouncements, now\)/);
  assert.match(page, /upcomingDeadlines\(regularHomepageAnnouncements, now\)/);
  assert.match(page, /deadlineUrgency\(deadline\.date, now\)/);
});

test("即將截止依緊急程度只調整期限 badge、日期與時間顏色", () => {
  const styles = source("app/globals.css");
  assert.match(styles, /\.urgency-red \.deadline-status\{background:#c62828\}/);
  assert.match(styles, /\.urgency-red \.deadline-date,\.urgency-red \.deadline-time\{color:#c62828\}/);
  assert.match(styles, /\.urgency-orange \.deadline-status\{background:#d56a00\}/);
  assert.match(styles, /\.urgency-orange \.deadline-date,\.urgency-orange \.deadline-time\{color:#d56a00\}/);
  assert.match(styles, /\.urgency-normal \.deadline-status\{background:#64788c\}/);
  assert.doesNotMatch(styles, /\.urgency-(?:red|orange|normal) \.deadline-main>strong/);
  assert.doesNotMatch(styles, /\.urgency-(?:red|orange|normal) \.department-badge/);
});
