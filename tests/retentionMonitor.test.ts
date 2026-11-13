import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyRetentionRow, countRowStates, daysBetween, filterRetentionRows, formatDateKey, formatTaipeiDateTime, paginateRows,
  RETENTION_MODE_INFO, RETENTION_PREVIEW_PAGE_SIZE, RETENTION_ROW_STATE_LABELS, retentionReasonLabels, type RetentionStatusAnnouncement,
} from "../lib/retentionMonitor.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const row = (id: string, overrides: Partial<RetentionStatusAnnouncement> = {}): RetentionStatusAnnouncement => ({
  id, title: `公告 ${id}`, department: "設備組", publicationStatus: "published", retentionPolicy: "autoCleanup", category: "dated",
  basisDate: "2026-09-01", baseCleanupDate: "2026-12-15", latestUpdateDate: null, protectionDate: null, finalCleanupDate: "2026-12-15",
  eligible: false, skipReasons: ["not_yet_due"], ...overrides,
});
const TODAY = "2026-11-13";

test("M1 狀態分類：符合資格、尚未到期、已到期但受保護、長期保留、安全阻擋", () => {
  assert.equal(classifyRetentionRow(row("a", { eligible: true, skipReasons: [] })), "eligible");
  assert.equal(classifyRetentionRow(row("b")), "notYetDue");
  assert.equal(classifyRetentionRow(row("c", { skipReasons: ["collection_in_progress"] })), "dueButProtected");
  assert.equal(classifyRetentionRow(row("d", { skipReasons: ["line_notice_pending"] })), "dueButProtected");
  assert.equal(classifyRetentionRow(row("e", { retentionPolicy: "longTerm", skipReasons: ["retention_long_term"] })), "longTerm");
  assert.equal(classifyRetentionRow(row("f", { category: "invalid", finalCleanupDate: null, skipReasons: ["invalid_schedule_dates"] })), "blocked");
  assert.equal(classifyRetentionRow(row("g", { skipReasons: ["retention_unreviewed"] })), "blocked");
  assert.equal(classifyRetentionRow(row("h", { skipReasons: ["not_yet_due", "line_notices_unavailable"] })), "blocked", "狀態不明優先於尚未到期");
});

test("M2 受保護的公告絕不標為可清理，標籤文字不含「即將刪除」", () => {
  for (const reasons of [["collection_in_progress"], ["line_notice_pending"], ["deletion_in_progress"], ["not_yet_due", "collection_in_progress"]]) {
    assert.notEqual(classifyRetentionRow(row("x", { skipReasons: reasons })), "eligible", reasons.join());
  }
  assert.equal(classifyRetentionRow(row("y", { eligible: false, skipReasons: [] })), "dueButProtected", "後端未判定 eligible 時不推測可刪除");
  for (const label of Object.values(RETENTION_ROW_STATE_LABELS)) assert.doesNotMatch(label, /即將刪除/);
  assert.equal(RETENTION_ROW_STATE_LABELS.dueButProtected, "已到期但受保護");
});

test("M3 保護原因使用後端中文說明，不重複列出尚未到期與長期保留", () => {
  const labels = retentionReasonLabels(row("a", { skipReasons: ["not_yet_due", "line_notice_pending", "retention_long_term"] }));
  assert.equal(labels.length, 1);
  assert.doesNotMatch(labels[0], /line_notice_pending/);
  assert.deepEqual(retentionReasonLabels(row("b", { skipReasons: ["unknown_code"] })), ["unknown_code"]);
});

test("M4 60 天內篩選：依日期排序、含已到期與無日期的異常公告、排除長期保留與 60 天後", () => {
  const rows = [
    row("late", { finalCleanupDate: "2027-03-01" }),
    row("soon", { finalCleanupDate: "2027-01-12" }),
    row("past", { finalCleanupDate: "2026-11-01", skipReasons: ["collection_in_progress"] }),
    row("edge", { finalCleanupDate: "2027-01-13" }),
    row("keep", { retentionPolicy: "longTerm", finalCleanupDate: null, skipReasons: ["retention_long_term"] }),
    row("bad", { category: "invalid", finalCleanupDate: null, skipReasons: ["invalid_schedule_dates"] }),
  ];
  assert.equal(daysBetween(TODAY, "2027-01-12"), 60);
  assert.deepEqual(filterRetentionRows(rows, "within60", TODAY).map(r => r.id), ["past", "soon", "bad"]);
  assert.deepEqual(filterRetentionRows(rows, "all", TODAY).map(r => r.id), ["past", "soon", "edge", "late", "bad", "keep"]);
});

test("M5 各狀態計數與分頁（每頁 50 篇，頁碼越界自動校正）", () => {
  const rows = Array.from({ length: 120 }, (_, i) => row(String(i).padStart(3, "0")));
  assert.equal(RETENTION_PREVIEW_PAGE_SIZE, 50);
  assert.deepEqual(countRowStates([row("a", { eligible: true, skipReasons: [] }), row("b"), row("c", { skipReasons: ["collection_in_progress"] })]), { eligible: 1, notYetDue: 1, dueButProtected: 1, longTerm: 0, blocked: 0 });
  const last = paginateRows(rows, 3);
  assert.equal(last.pageCount, 3);
  assert.equal(last.pageRows.length, 20);
  assert.equal(paginateRows(rows, 99).page, 3);
  assert.equal(paginateRows(rows, 0).page, 1);
  assert.deepEqual(paginateRows([], 1), { page: 1, pageCount: 1, pageRows: [] });
});

test("M6 臺灣時區格式與模式說明", () => {
  assert.equal(formatTaipeiDateTime("2026-11-12T19:00:05.000Z"), "2026/11/13 03:00");
  assert.equal(formatTaipeiDateTime(null), "—");
  assert.equal(formatTaipeiDateTime("not-a-date"), "—");
  assert.equal(formatDateKey("2027-01-30"), "2027/01/30");
  assert.equal(RETENTION_MODE_INFO.live.label, "已啟用自動永久刪除");
  assert.equal(RETENTION_MODE_INFO.dryRun.label, "僅模擬檢查");
  assert.equal(RETENTION_MODE_INFO.off.label, "停止自動清理");
});

test("M7 監控頁：systemAdmin 守門、只呼叫唯讀 callable、沒有刪除按鈕、註明不會刪除", () => {
  const page = source("app/admin/retention-monitor/page.tsx");
  const view = source("app/admin/retention-monitor/retention-monitor-view.tsx");
  const lib = source("lib/retentionMonitor.ts");
  assert.match(page, /<AdminAuthGuard>/);
  assert.match(page, /publisher\.role !== "systemAdmin"/);
  assert.match(lib, /"getRetentionCleanupStatus"/);
  for (const text of [page, view, lib]) {
    assert.doesNotMatch(text, /retentionCleanupDaily/);
    assert.doesNotMatch(text, /permanentlyDelete|deleteDoc|updateDoc|setDoc|writeBatch|runTransaction/);
    assert.doesNotMatch(text, /永久刪除<\/|刪除公告<\/|>刪除</);
  }
  assert.match(view, /僅重新檢查，不會刪除或修改公告。/);
  assert.match(view, /執行紀錄尚未啟用/);
  assert.match(view, /60 天內到期/);
  assert.match(view, /全部公告/);
});

test("M8 後台導覽：主要功能區有自動清理監控，舊公告審查移到進階管理且網址不變", () => {
  const admin = source("app/admin/page.tsx");
  const main = admin.slice(admin.indexOf('aria-label="行政管理功能"'), admin.indexOf("進階管理</h2>"));
  const advanced = admin.slice(admin.indexOf('aria-label="進階管理功能"'));
  assert.match(main, /isSystemAdmin && <Link href="\/admin\/retention-monitor">/);
  assert.doesNotMatch(main, /retention-review/);
  assert.match(admin, /\{isSystemAdmin && <>\n\s+<h2 className=\{styles\.sectionTitle\}>進階管理<\/h2>/);
  assert.match(advanced, /href="\/admin\/retention-review"/);
  for (const href of ["/publish", "/manage", "/admin/analytics", "/admin/publishers", "/"]) assert.match(main, new RegExp(`href="${href.replace(/\//g, "\\/")}"`));
});

test("M9 前端載入的 functions 原始碼不得依賴 firebase-admin／firebase-functions（CI 只安裝根目錄套件）", () => {
  const visited = new Set<string>();
  const queue = ["lib/retentionMonitor.ts"];
  while (queue.length) {
    const file = queue.shift() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const text = source(file);
    assert.doesNotMatch(text, /from "firebase-admin|from "firebase-functions/, `${file} 不得 import firebase-admin／firebase-functions`);
    for (const [, spec] of text.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
      const resolved = new URL(spec.replace(/\.js$/, ".ts"), new URL(`../${file}`, import.meta.url)).pathname.replace(/^.*?\/ysjh-info\//, "");
      if (resolved.startsWith("functions/")) queue.push(resolved);
    }
  }
  assert.ok(visited.has("functions/src/retentionCleanupStatusTypes.ts"));
  assert.ok(!visited.has("functions/src/retentionCleanupStatus.ts"));
});
