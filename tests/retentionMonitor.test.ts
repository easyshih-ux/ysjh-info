import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyRetentionRow, countRowStates, daysBetween, filterRetentionRows, formatDateKey, formatTaipeiDateTime, paginateRows,
  RETENTION_MODE_INFO, RETENTION_PREVIEW_PAGE_SIZE, RETENTION_ROW_STATE_LABELS, retentionReasonLabels, type RetentionStatusAnnouncement,
  assessRetentionRunHistory, latestExpectedRunSlot, retentionRunResultInfo, RETENTION_RUN_RESULT_LABELS,
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
  assert.match(view, /歷史紀錄尚未開始累積/);
  assert.doesNotMatch(view, /執行紀錄尚未啟用/, "Gate 5A 起改為「尚未開始累積」");
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
  // 以專案根目錄為基準計算相對路徑，不依賴資料夾名稱（CI 路徑為 /home/runner/work/ysjh-info/ysjh-info/）。
  const repoRoot = new URL("../", import.meta.url).pathname;
  const visited = new Set<string>();
  const queue = ["lib/retentionMonitor.ts"];
  while (queue.length) {
    const file = queue.shift() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const text = source(file);
    assert.doesNotMatch(text, /from "firebase-admin|from "firebase-functions/, `${file} 不得 import firebase-admin／firebase-functions`);
    for (const [, spec] of text.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
      const resolved = new URL(spec.replace(/\.js$/, ".ts"), new URL(`../${file}`, import.meta.url)).pathname.slice(repoRoot.length);
      if (resolved.startsWith("functions/")) queue.push(resolved);
    }
  }
  assert.ok(visited.has("functions/src/retentionCleanupStatusTypes.ts"));
  assert.ok(!visited.has("functions/src/retentionCleanupStatus.ts"));
});

test("M10 執行結果中文化：六種已知結果；缺少或未知一律「狀態待確認」，絕不顯示成功", () => {
  const expected = { completed: "正常完成", completedWithErrors: "完成但有異常", stoppedAfterFailure: "發生錯誤，已停止", off: "清理已停用", rejected: "執行遭拒絕", failed: "執行失敗" };
  assert.deepEqual(RETENTION_RUN_RESULT_LABELS, expected);
  for (const [result, label] of Object.entries(expected)) assert.deepEqual([retentionRunResultInfo(result).label, retentionRunResultInfo(result).known], [label, true]);
  assert.equal(retentionRunResultInfo("completed").tone, "ok");
  assert.equal(retentionRunResultInfo("stoppedAfterFailure").tone, "error");
  assert.equal(retentionRunResultInfo("off").tone, "neutral", "off 不是錯誤");
  for (const value of [null, undefined, "", "success", "COMPLETED", "toString", "__proto__"]) {
    const info = retentionRunResultInfo(value as string | null);
    assert.deepEqual(info, { label: "狀態待確認", tone: "unknown", known: false }, String(value));
  }
});

// 臺灣時間 → UTC ISO（臺灣固定 UTC+8）
const taipei = (local: string) => new Date(Date.parse(`${local}+08:00`)).toISOString();
const runAt = (local: string) => ({ startedAt: taipei(local) });

test("M11 03:00 前後與 05:00 寫入緩衝的時間判斷", () => {
  // 11/14 04:59 → 今天 03:00 的紀錄還在緩衝內，只要求 11/13 03:00
  assert.equal(new Date(latestExpectedRunSlot(Date.parse(taipei("2026-11-14T04:59:59")))).toISOString(), taipei("2026-11-13T03:00:00"));
  // 11/14 05:00 起要求 11/14 03:00
  assert.equal(new Date(latestExpectedRunSlot(Date.parse(taipei("2026-11-14T05:00:00")))).toISOString(), taipei("2026-11-14T03:00:00"));
  // 臺灣 00:30（UTC 仍是前一天 16:30）→ 要求前一天 03:00
  assert.equal(new Date(latestExpectedRunSlot(Date.parse(taipei("2026-11-14T00:30:00")))).toISOString(), taipei("2026-11-13T03:00:00"));
  const yesterday = [runAt("2026-11-13T03:00:04")];
  assert.equal(assessRetentionRunHistory(yesterday, taipei("2026-11-14T03:01:00")).kind, "current", "03:00 剛過不提醒");
  assert.equal(assessRetentionRunHistory(yesterday, taipei("2026-11-14T04:59:00")).kind, "current", "緩衝內不提醒");
  assert.equal(assessRetentionRunHistory(yesterday, taipei("2026-11-14T05:00:00")).kind, "overdue", "05:00 仍沒有今天的紀錄才提醒");
  assert.equal(assessRetentionRunHistory([runAt("2026-11-14T03:00:02"), ...yesterday], taipei("2026-11-14T05:00:00")).kind, "current");
  assert.equal(assessRetentionRunHistory([runAt("2026-11-14T02:59:58")], taipei("2026-11-14T09:00:00")).kind, "current", "提早幾秒觸發仍算當天");
  assert.equal(assessRetentionRunHistory([runAt("2026-11-14T02:30:00")], taipei("2026-11-14T09:00:00")).kind, "overdue", "超過容許範圍的舊紀錄不算");
});

test("M12 延遲只提醒：沒有紀錄不提醒；off 與失敗紀錄都代表排程有執行；時間無法判讀另行提醒", () => {
  assert.deepEqual(assessRetentionRunHistory([], taipei("2027-03-01T12:00:00")), { kind: "notStarted" }, "尚未部署或尚未執行：不誤報");
  const now = taipei("2026-11-14T10:00:00");
  const offToday = [{ startedAt: taipei("2026-11-14T03:00:03"), result: "off" }];
  assert.equal(assessRetentionRunHistory(offToday, now).kind, "current", "off 模式的正常紀錄不視為故障");
  assert.equal(assessRetentionRunHistory([{ startedAt: taipei("2026-11-14T03:00:03"), result: "stoppedAfterFailure" }], now).kind, "current", "延遲提醒只看是否有新紀錄");
  const stale = assessRetentionRunHistory([runAt("2026-11-11T03:00:03"), runAt("2026-11-12T03:00:03")], now);
  assert.deepEqual(stale, { kind: "overdue", latestStartedAt: taipei("2026-11-12T03:00:03"), expectedSlot: taipei("2026-11-14T03:00:00") }, "以最新一筆判斷，不依賴排序");
  assert.deepEqual(assessRetentionRunHistory([{ startedAt: null }, { startedAt: "bad" }], now), { kind: "unreadable" });
  assert.equal(assessRetentionRunHistory([runAt("2026-11-11T03:00:03")], "not-a-date").kind, "current", "伺服器時間無效時不提醒");
});

test("M13 介面：結果標籤與延遲提醒文字；提醒不宣稱清理失敗", () => {
  const view = source("app/admin/retention-monitor/retention-monitor-view.tsx");
  assert.match(view, /<ResultBadge result=\{latestRun\.result\} \/>/);
  assert.match(view, /<ResultBadge result=\{run\.result\} \/>/);
  assert.match(view, /近期未取得新的執行紀錄，建議確認排程狀態/);
  assert.match(view, /assessRetentionRunHistory\(data\.runs, data\.generatedAt\)/, "以伺服器時間判斷");
  assert.doesNotMatch(view, /自動清理失敗<|清理失敗了|排程異常</);
  assert.match(view, /不代表自動清理失敗/);
});

test("M14 例外紀錄（數量為 null）：介面不顯示 0、不顯示正常完成，改為「無法確認」", () => {
  const view = source("app/admin/retention-monitor/retention-monitor-view.tsx");
  assert.match(view, /if \(run\.scanned === null && run\.deleted === null && run\.failed === null\) return `\$\{mode\}：處理篇數無法確認，請查閱 Cloud Logging`;/);
  assert.match(view, /run\.scanned === null \? "本次處理結果無法確認，請查閱 Cloud Logging。" : "本次沒有處理任何公告。"/);
  assert.match(view, /掃描 \{run\.scanned \?\? "—"\}/);
  assert.match(view, /刪除 \{run\.deleted \?\? "—"\}/);
  assert.match(view, /失敗 \{run\.failed \?\? "—"\}/);
  assert.deepEqual(retentionRunResultInfo("failed"), { label: "執行失敗", tone: "error", known: true });
});
