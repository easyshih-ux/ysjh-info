import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { createRetentionStatusCache, getRetentionCleanupStatusHandler, parseRunSummary, RETENTION_STATUS_CACHE_TTL_MILLISECONDS, RETENTION_STATUS_REFRESH_INTERVAL_MILLISECONDS } from "../src/retentionCleanupStatus.ts";
import { runRetentionCleanup, type RetentionCleanupReader } from "../src/retentionCleanupJob.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const NOW = Date.parse("2027-01-20T01:00:00.000Z"); // 臺灣 2027-01-20 09:00
const announcement = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115, publishedAt: "2026-08-01T02:00:00.000Z", department: "設備組", title: "公告", content: "完整內容不應回傳",
  publicationStatus: "published", retentionPolicy: "autoCleanup", importantEvents: [], deadlines: [{ date: "2026-09-01", label: "繳交" }], ...overrides,
});

function profiles(map: Record<string, Record<string, unknown>>) {
  return { collection: (name: string) => ({ doc: (id: string) => ({ get: async () => { assert.equal(name, "authorizedPublishers"); const data = map[id]; return { exists: data !== undefined, data: () => data }; } }) }) } as unknown as Firestore;
}
const firestore = profiles({ adminA: { role: "systemAdmin", enabled: true }, userA: { role: "publisher", enabled: true }, disabledAdmin: { role: "systemAdmin", enabled: false } });

function fakeReader(options: { settings?: unknown; announcements?: { id: string; data: unknown }[]; lineNotices?: Record<string, unknown[]> } = {}) {
  let listCalls = 0;
  const reader: RetentionCleanupReader = {
    readSettings: async () => options.settings ?? { mode: "live" },
    listAnnouncements: async () => { listCalls++; return (options.announcements ?? []).map(item => ({ ...item })); },
    readFollowUps: async () => [],
    readLineNotices: async id => options.lineNotices?.[id] ?? [],
  };
  return { reader, listCalls: () => listCalls };
}
const call = (uid: string | null, data: unknown, deps: Parameters<typeof getRetentionCleanupStatusHandler>[1]) => getRetentionCleanupStatusHandler({ auth: uid ? { uid } : null, data }, { firestore, readRuns: async () => [], ...deps });

test("權限：未登入、一般發布者、停用的管理員、不存在的帳號都被拒絕，且不讀取任何公告", async () => {
  const probe = fakeReader({ announcements: [{ id: "a", data: announcement() }] });
  await assert.rejects(call(null, {}, { reader: probe.reader, cache: createRetentionStatusCache() }), (error: { code?: string }) => error.code === "unauthenticated");
  for (const uid of ["userA", "disabledAdmin", "stranger"]) {
    await assert.rejects(call(uid, {}, { reader: probe.reader, cache: createRetentionStatusCache() }), (error: { code?: string }) => error.code === "permission-denied", uid);
  }
  assert.equal(probe.listCalls(), 0);
});

test("參數驗證：只接受空物件或 { refresh: boolean }", async () => {
  for (const data of [{ refresh: "yes" }, { other: 1 }, [], "refresh", 1]) {
    await assert.rejects(call("adminA", data, { reader: fakeReader().reader, cache: createRetentionStatusCache() }), (error: { code?: string }) => error.code === "invalid-argument", JSON.stringify(data));
  }
  for (const data of [undefined, null, {}, { refresh: false }, { refresh: true }]) {
    await call("adminA", data, { reader: fakeReader().reader, cache: createRetentionStatusCache(), now: () => NOW });
  }
});

test("預覽：任何模式下都依今天重新計算，與排程判斷完全一致；回傳標題但不含公告內文", async () => {
  const announcements = [
    { id: "due", data: announcement({ title: "已到期" }) },
    { id: "keep", data: announcement({ title: "長期保留", retentionPolicy: "longTerm" }) },
    { id: "chase", data: announcement({ title: "催繳中", collectionStatus: "chasing" }) },
    { id: "line", data: announcement({ title: "LINE 待處理" }) },
    { id: "future", data: announcement({ title: "未到期", deadlines: [{ date: "2027-01-10", label: "x" }] }) },
  ];
  for (const mode of ["live", "dryRun", "off"]) {
    const { reader } = fakeReader({ settings: { mode }, announcements, lineNotices: { line: [{ status: "pending" }] } });
    const status = await call("adminA", {}, { reader, cache: createRetentionStatusCache(), now: () => NOW });
    assert.equal(status.settings.mode, mode);
    assert.equal(status.today, "2027-01-20");
    assert.deepEqual(status.summary.wouldDeleteToday, ["due"], mode);
    const byId = Object.fromEntries(status.announcements.map(row => [row.id, row]));
    assert.deepEqual(byId.due, { id: "due", title: "已到期", department: "設備組", publicationStatus: "published", retentionPolicy: "autoCleanup", category: "dated", basisDate: "2026-09-01", baseCleanupDate: "2026-12-15", latestUpdateDate: null, protectionDate: null, finalCleanupDate: "2026-12-15", eligible: true, skipReasons: [] });
    assert.deepEqual(byId.keep.skipReasons, ["retention_long_term"]);
    assert.deepEqual(byId.chase.skipReasons, ["collection_in_progress"]);
    assert.deepEqual(byId.line.skipReasons, ["line_notice_pending"]);
    assert.deepEqual(byId.future.skipReasons, ["not_yet_due"]);
    assert.equal(JSON.stringify(status).includes("完整內容不應回傳"), false);
  }
  // 與排程（dryRun）的判斷逐篇比對。
  const { reader } = fakeReader({ settings: { mode: "dryRun" }, announcements, lineNotices: { line: [{ status: "pending" }] } });
  const scheduled = await runRetentionCleanup(reader, NOW);
  const status = await call("adminA", {}, { reader, cache: createRetentionStatusCache(), now: () => NOW });
  for (const decision of scheduled.decisions) {
    const row = status.announcements.find(item => item.id === decision.id)!;
    assert.deepEqual({ eligible: row.eligible, skipReasons: row.skipReasons, finalCleanupDate: row.finalCleanupDate }, { eligible: decision.eligible, skipReasons: decision.skipReasons, finalCleanupDate: decision.finalCleanupDate }, decision.id);
  }
  assert.deepEqual(status.summary.wouldDeleteToday, scheduled.wouldDeleteToday.map(item => item.id));
  assert.deepEqual(status.announcements.map(row => row.finalCleanupDate), [...status.announcements.map(row => row.finalCleanupDate)].sort(), "依最終清理日期排序");
});

test("快取：5 分鐘內重用結果；立即檢查每 60 秒最多重新計算一次；超過 5 分鐘自動重新計算", async () => {
  const probe = fakeReader({ announcements: [{ id: "a", data: announcement() }] });
  const cache = createRetentionStatusCache();
  let now = NOW;
  const deps = { reader: probe.reader, cache, now: () => now };
  const first = await call("adminA", {}, deps);
  assert.deepEqual([first.cached, first.refreshThrottled, probe.listCalls()], [false, false, 1]);
  now += 30_000;
  const throttled = await call("adminA", { refresh: true }, deps);
  assert.deepEqual([throttled.cached, throttled.refreshThrottled, probe.listCalls()], [true, true, 1]);
  assert.equal(throttled.nextRefreshAt, new Date(NOW + RETENTION_STATUS_REFRESH_INTERVAL_MILLISECONDS).toISOString());
  const cached = await call("adminA", {}, deps);
  assert.deepEqual([cached.cached, cached.refreshThrottled, probe.listCalls()], [true, false, 1]);
  now = NOW + RETENTION_STATUS_REFRESH_INTERVAL_MILLISECONDS;
  const refreshed = await call("adminA", { refresh: true }, deps);
  assert.deepEqual([refreshed.cached, refreshed.refreshThrottled, probe.listCalls()], [false, false, 2]);
  now += RETENTION_STATUS_CACHE_TTL_MILLISECONDS;
  const expired = await call("adminA", {}, deps);
  assert.deepEqual([expired.cached, probe.listCalls()], [false, 3]);
});

test("執行紀錄：讀取失敗不影響預覽；紀錄欄位缺漏時以 null 表示，個別結果最多 50 筆", async () => {
  const status = await call("adminA", {}, { reader: fakeReader().reader, cache: createRetentionStatusCache(), now: () => NOW, readRuns: async () => { throw new Error("missing index"); } });
  assert.deepEqual(status.runs, []);
  assert.match(status.errors.join(), /runs: missing index/);
  const parsed = parseRunSummary({ id: "r1", data: { runDate: "2027-01-20", startedAtUtc: "2027-01-19T19:00:05.000Z", startedAtTaipei: "2027-01-20 03:00:05 (Asia/Taipei)", status: "live", mode: "live", scanned: 40, eligible: 2, skipped: 38, liveCounts: { deleted: 1, failed: 1 }, errorCount: 1, liveResults: [{ id: "a", outcome: "deleted", finalCleanupDate: "2027-01-19" }, { id: "b", outcome: "failed", stage: "delete", message: "x" }, { id: "c", outcome: "race_unclaimed", reasons: ["line_notice_pending"] }, "bad"] } });
  assert.deepEqual(parsed, { id: "r1", runDate: "2027-01-20", startedAt: "2027-01-19T19:00:05.000Z", startedAtTaipei: "2027-01-20 03:00:05 (Asia/Taipei)", status: "live", mode: "live", scanned: 40, eligible: 2, skipped: 38, deleted: 1, failed: 1, errorCount: 1, results: [{ id: "a", outcome: "deleted" }, { id: "b", outcome: "failed", detail: "delete" }, { id: "c", outcome: "race_unclaimed", detail: "line_notice_pending" }] });
  assert.deepEqual(parseRunSummary({ id: "r2", data: { status: "dryRun" } }).deleted, null);
  assert.equal(parseRunSummary({ id: "r3", data: { liveResults: Array.from({ length: 80 }, (_, index) => ({ id: `x${index}`, outcome: "deleted" })) } }).results.length, 50);
});

test("唯讀保證：狀態查詢模組不含任何寫入、刪除或觸發排程的呼叫", () => {
  const code = source("retentionCleanupStatus.ts");
  assert.doesNotMatch(code, /announcementDeletion|retentionCleanupLive|createRetentionDeleter|permanentlyDeleteAnnouncement|recursiveDelete|deleteFiles|getStorage|runTransaction|\.batch\(|\.set\(|\.update\(|\.delete\(|\.add\(|\.create\(|cloudscheduler|deletionStartedAt:/);
  assert.match(code, /createFirestoreRetentionCleanupReader\(firestore\)/);
  assert.match(code, /\.orderBy\("startedAtUtc", "desc"\)\.limit\(RETENTION_STATUS_MAX_RUNS\)\.get\(\)/);
});
