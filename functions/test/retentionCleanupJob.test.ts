import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { AnnouncementDeletionCleanupError, permanentlyDeleteAnnouncement } from "../src/announcementDeletion.ts";
import { evaluateRetentionCleanup } from "../src/retentionCleanup.ts";
import {
  createFirestoreRetentionCleanupReader, formatTaipeiDateTime, parseRetentionCleanupSettings, retentionCleanupLogSummary, RETENTION_CLEANUP_LOG_MAX_ERRORS, revalidateBeforeDeletion, runRetentionCleanup,
  RETENTION_CLEANUP_MAX_PER_RUN, type RetentionCleanupReader,
} from "../src/retentionCleanupJob.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2027-01-20T01:00:00.000Z"); // 臺灣 2027-01-20
const ts = (iso: string) => ({ toMillis: () => Date.parse(iso) });
const announcement = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115, publishedAt: "2026-08-01T02:00:00.000Z", department: "設備組", title: "公告", content: "內容",
  publicationStatus: "published", retentionPolicy: "autoCleanup", importantEvents: [], deadlines: [{ date: "2026-09-01", label: "繳交" }], ...overrides,
});

function fakeReader(options: { settings?: unknown; settingsError?: Error; announcements?: { id: string; data: unknown }[]; followUps?: Record<string, unknown[] | Error>; lineNotices?: Record<string, unknown[] | Error> } = {}) {
  const calls: string[] = [];
  const reader: RetentionCleanupReader = {
    readSettings: async () => { calls.push("settings"); if (options.settingsError) throw options.settingsError; return options.settings ?? null; },
    listAnnouncements: async () => { calls.push("list"); return (options.announcements ?? []).map(item => ({ ...item })); },
    readFollowUps: async id => { calls.push(`followUps/${id}`); const value = options.followUps?.[id] ?? []; if (value instanceof Error) throw value; return value; },
    readLineNotices: async id => { calls.push(`lineNotices/${id}`); const value = options.lineNotices?.[id] ?? []; if (value instanceof Error) throw value; return value; },
  };
  return { reader, calls };
}

// ===== 設定與模式 =====

test("設定：缺少或不合法一律 off；上限只能是 1～20 的整數", () => {
  assert.deepEqual(parseRetentionCleanupSettings(null), { mode: "off", requestedMode: undefined, maxDeletesPerRun: 20 });
  for (const mode of ["", "DRYRUN", "on", 1, true]) assert.equal(parseRetentionCleanupSettings({ mode }).mode, "off", String(mode));
  assert.equal(parseRetentionCleanupSettings({ mode: "dryRun" }).mode, "dryRun");
  assert.equal(parseRetentionCleanupSettings({ mode: "live" }).mode, "live");
  assert.equal(parseRetentionCleanupSettings({ mode: "dryRun", maxDeletesPerRun: 5 }).maxDeletesPerRun, 5);
  for (const max of [0, -1, 1.5, "10", 999]) assert.equal(parseRetentionCleanupSettings({ mode: "dryRun", maxDeletesPerRun: max }).maxDeletesPerRun, max === 999 ? 20 : 20, String(max));
  assert.equal(RETENTION_CLEANUP_MAX_PER_RUN, 20);
});

test("off（含缺少設定、設定讀取失敗）：不掃描公告", async () => {
  for (const options of [{}, { settings: { mode: "off" } }, { settings: { mode: "unknown" } }, { settingsError: new Error("unavailable") }]) {
    const { reader, calls } = fakeReader({ ...options, announcements: [{ id: "a", data: announcement() }] });
    const report = await runRetentionCleanup(reader, NOW);
    assert.equal(report.status, "off");
    assert.deepEqual(calls, ["settings"], "不得讀取公告");
    assert.equal(report.scanned, 0);
  }
});

test("live：本階段一律拒絕，不掃描、不判斷、不刪除", async () => {
  const { reader, calls } = fakeReader({ settings: { mode: "live" }, announcements: [{ id: "a", data: announcement() }] });
  const report = await runRetentionCleanup(reader, NOW);
  assert.equal(report.status, "rejectedLive");
  assert.deepEqual(calls, ["settings"]);
  assert.deepEqual(report.wouldDeleteToday, []);
  assert.match(report.errors.join(), /live mode is not enabled/);
});

// ===== dry-run =====

test("dryRun：只產生判斷結果；非 autoCleanup 與刪除中的公告不讀子集合；異常跳過", async () => {
  const { reader, calls } = fakeReader({
    settings: { mode: "dryRun" },
    announcements: [
      { id: "due", data: announcement() },
      { id: "keep", data: announcement({ retentionPolicy: "longTerm" }) },
      { id: "deleting", data: announcement({ deletionStartedAt: ts("2027-01-01T00:00:00Z") }) },
      { id: "badDate", data: announcement({ importantEvents: [{ date: "2026-09-10", endDate: "2026-09-01", title: "x" }] }) },
      { id: "chase", data: announcement({ collectionStatus: "chasing" }) },
      { id: "line", data: announcement() },
      { id: "followFail", data: announcement() },
    ],
    lineNotices: { line: [{ status: "pending" }] },
    followUps: { followFail: new Error("timeout") },
  });
  const report = await runRetentionCleanup(reader, NOW);
  assert.equal(report.status, "dryRun");
  assert.equal(report.today, "2027-01-20");
  const reasons = Object.fromEntries(report.decisions.map(decision => [decision.id, decision.eligible ? "eligible" : decision.skipReasons.join("+")]));
  assert.deepEqual(reasons, {
    due: "eligible", keep: "retention_long_term", deleting: "deletion_in_progress", badDate: "invalid_schedule_dates",
    chase: "collection_in_progress", line: "line_notice_pending", followFail: "follow_ups_unavailable",
  });
  assert.equal(calls.includes("followUps/keep") || calls.includes("followUps/deleting"), false, "非候選不讀子集合");
  assert.deepEqual(report.wouldDeleteToday, [{ id: "due", finalCleanupDate: "2026-12-15", category: "dated", basisDate: "2026-09-01", baseCleanupDate: "2026-12-15", latestUpdateDate: null, protectionDate: null }]);
  assert.match(report.errors.join(), /followUps\/followFail: timeout/);
});

test("超過上限：依最終清理日期由早到晚取前 N 篇預覽，其餘列為延後", async () => {
  const announcements = Array.from({ length: 25 }, (_, index) => ({ id: `n${String(index).padStart(2, "0")}`, data: announcement({ deadlines: [{ date: `2026-08-${String(index + 1).padStart(2, "0")}`, label: "x" }] }) }));
  const report = await runRetentionCleanup(fakeReader({ settings: { mode: "dryRun" }, announcements: announcements.reverse() }).reader, NOW);
  assert.equal(report.eligible, 25);
  assert.equal(report.wouldDeleteToday.length, 20);
  assert.equal(report.deferred.length, 5);
  assert.equal(report.wouldDeleteToday[0].id, "n00");
  assert.deepEqual(report.deferred.map(item => item.id), ["n20", "n21", "n22", "n23", "n24"]);
  const limited = await runRetentionCleanup(fakeReader({ settings: { mode: "dryRun", maxDeletesPerRun: 5 }, announcements }).reader, NOW);
  assert.deepEqual([limited.wouldDeleteToday.length, limited.deferred.length], [5, 20]);
});

test("同一天重複觸發：dry-run 結果相同，且不寫入任何資料", async () => {
  const options = { settings: { mode: "dryRun" }, announcements: [{ id: "a", data: announcement() }, { id: "b", data: announcement({ retentionPolicy: "longTerm" }) }] };
  const first = await runRetentionCleanup(fakeReader(options).reader, NOW);
  const second = await runRetentionCleanup(fakeReader(options).reader, NOW + 60_000);
  assert.deepEqual({ ...first, startedAt: "" }, { ...second, startedAt: "" });
});

test("清單讀取失敗：回報 failed，不產生任何處理清單", async () => {
  const reader: RetentionCleanupReader = { ...fakeReader({ settings: { mode: "dryRun" } }).reader, listAnnouncements: async () => { throw new Error("unavailable"); } };
  const report = await runRetentionCleanup(reader, NOW);
  assert.equal(report.status, "failed");
  assert.deepEqual(report.wouldDeleteToday, []);
});

test("正式 Firestore 讀取器只使用 get()，任何寫入或刪除都會使測試失敗", async () => {
  const forbidden = () => { throw new Error("write attempted"); };
  const snapshot = (rows: Record<string, unknown>[]) => ({ docs: rows.map((data, index) => ({ id: `d${index}`, data: () => data })) });
  const docRef = (path: string): unknown => ({
    get: async () => path === "systemSettings/retentionCleanup" ? { exists: true, data: () => ({ mode: "dryRun" }) } : { exists: false, data: () => undefined },
    collection: (name: string) => ({ get: async () => snapshot(name === "lineNotices" ? [{ status: "sent" }] : []), add: forbidden, doc: forbidden }),
    set: forbidden, update: forbidden, delete: forbidden, create: forbidden,
  });
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
      get: async () => snapshot(name === "announcements" ? [announcement()] : []),
      add: forbidden,
    }),
    runTransaction: forbidden, batch: forbidden, bulkWriter: forbidden, recursiveDelete: forbidden,
  } as unknown as Firestore;
  const report = await runRetentionCleanup(createFirestoreRetentionCleanupReader(firestore), NOW);
  assert.equal(report.status, "dryRun");
  assert.equal(report.eligible, 1);
});

test("dry-run 與排程程式碼不含刪除或寫入能力；排程設定正確且未從 index.ts 匯出", () => {
  const job = source("retentionCleanupJob.ts");
  const schedule = source("retentionCleanupSchedule.ts");
  for (const code of [job, schedule]) {
    assert.doesNotMatch(code, /announcementDeletion|permanentlyDeleteAnnouncement\(|recursiveDelete|deleteFiles|getStorage|runTransaction|\.batch\(|\.set\(|\.update\(|\.delete\(|\.add\(|deletionStartedAt:/);
  }
  assert.match(schedule, /schedule: "0 3 \* \* \*", timeZone: "Asia\/Taipei", region: "asia-east1", retryCount: 0/);
  const index = source("index.ts");
  assert.doesNotMatch(index, /retentionCleanup/, "排程尚未授權部署，不得從 index.ts 匯出");
  assert.doesNotMatch(index, /export[^\n]*permanentlyDeleteAnnouncement/, "內部刪除函式不得成為 Cloud Function 入口");
});

// ===== 共用永久刪除函式 =====

function memoryStore(initial: Record<string, Record<string, unknown>>) {
  const docs = new Map(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  const firestore = {
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    async runTransaction<T>(run: (transaction: unknown) => Promise<T>) {
      const writes: Array<() => void> = [];
      const transaction = {
        get: async (ref: { path: string }) => { const value = docs.get(ref.path); return { exists: value !== undefined, data: () => value && structuredClone(value) }; },
        update: (ref: { path: string }, patch: Record<string, unknown>) => writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...patch })),
        delete: (ref: { path: string }) => writes.push(() => docs.delete(ref.path)),
      };
      const result = await run(transaction); writes.forEach(write => write()); return result;
    },
  } as unknown as Firestore;
  return { firestore, get: (path: string) => docs.get(path) };
}

test("共用刪除：authorize 失敗時不寫入任何資料、不清理附件", async () => {
  const value = memoryStore({ "announcements/a1": announcement() });
  const events: string[] = [];
  await assert.rejects(permanentlyDeleteAnnouncement({
    firestore: value.firestore, announcementId: "a1", actor: "x",
    authorize: async () => { throw new Error("not allowed"); },
    cleanup: { cleanupSubcollections: async () => { events.push("sub"); }, cleanupStorage: async () => { events.push("storage"); } },
  }), /not allowed/);
  assert.deepEqual(events, []);
  assert.deepEqual(value.get("announcements/a1"), announcement());
});

test("共用刪除：依序標記、清子集合、清 Storage、再清子集合，最後才刪主文件；清理失敗保留主文件並可重試", async () => {
  const value = memoryStore({ "announcements/a1": announcement() });
  const events: string[] = [];
  const state = () => { const doc = value.get("announcements/a1"); return doc ? `${doc.publicationStatus}/${doc.deletionStartedBy ?? "-"}` : "gone"; };
  const cleanup = { cleanupSubcollections: async () => { events.push(`sub:${state()}`); }, cleanupStorage: async (id: string) => { events.push(`storage(${id}):${state()}`); } };
  await assert.rejects(permanentlyDeleteAnnouncement({ firestore: value.firestore, announcementId: "a1", actor: "admin", authorize: async () => {}, cleanup: { ...cleanup, cleanupStorage: async () => { throw new Error("storage down"); } } }), AnnouncementDeletionCleanupError);
  assert.equal(value.get("announcements/a1")?.deletionStartedBy, "admin");
  assert.deepEqual(events, ["sub:withdrawn/admin"], "Storage 失敗前已先標記並清子集合");
  events.length = 0;
  await permanentlyDeleteAnnouncement({ firestore: value.firestore, announcementId: "a1", actor: "other", authorize: async () => {}, cleanup });
  assert.deepEqual(events, ["sub:withdrawn/admin", "storage(a1):withdrawn/admin", "sub:withdrawn/admin"], "重試不重設刪除標記");
  assert.equal(value.get("announcements/a1"), undefined);
  await permanentlyDeleteAnnouncement({ firestore: value.firestore, announcementId: "a1", actor: "admin", authorize: async () => {}, cleanup });
  assert.equal(value.get("announcements/a1"), undefined, "重複執行仍安全");
});

// ===== 競爭條件：掃描後資料改變 =====

test("競爭條件：掃描後保存方式改變、新增補充、新增 LINE 待辦、進入催繳、開始人工刪除，皆不得繼續刪除", () => {
  const base = { id: "a1", data: announcement(), followUps: [], lineNotices: [], today: "2027-01-20" };
  const scanned = evaluateRetentionCleanup(base);
  assert.equal(scanned.eligible, true);
  const cases: [string, Partial<typeof base> & { data?: unknown }, string][] = [
    ["改為長期保留", { data: announcement({ retentionPolicy: "longTerm" }) }, "retention_long_term"],
    ["新增補充提醒", { followUps: [{ type: "supplement", status: "active", createdAt: ts("2027-01-19T02:00:00Z") }] as never }, "not_yet_due"],
    ["新增相關補充", { followUps: [{ type: "related", createdAt: ts("2027-01-19T02:00:00Z") }] as never }, "not_yet_due"],
    ["新增 LINE 待辦", { lineNotices: [{ status: "pending" }] as never }, "line_notice_pending"],
    ["進入催繳", { data: announcement({ collectionStatus: "chasing" }) }, "collection_in_progress"],
    ["人工刪除開始", { data: announcement({ deletionStartedAt: ts("2027-01-20T00:00:00Z") }) }, "deletion_in_progress"],
    ["管理員修改內容", { data: announcement({ contentUpdatedAt: "2027-01-19T03:00:00Z", updatedAt: "2027-01-19T03:00:00Z" }) }, "not_yet_due"],
  ];
  for (const [label, change, reason] of cases) {
    const result = revalidateBeforeDeletion(scanned, { ...base, ...change } as never);
    assert.equal(result.proceed, false, label);
    assert.ok(result.changed.includes(reason), `${label}: ${result.changed.join()}`);
  }
  const unchanged = revalidateBeforeDeletion(scanned, base);
  assert.deepEqual([unchanged.proceed, unchanged.changed], [true, []]);
  const withdrawn = revalidateBeforeDeletion(scanned, { ...base, data: announcement({ publicationStatus: "withdrawn" }) });
  assert.equal(withdrawn.proceed, true, "已下架公告仍依規則清理");
});

// ===== Cloud Logging 摘要 =====

test("日誌摘要：含執行日期與臺灣時間、掃描／符合／跳過篇數、前 20 篇 ID 與判斷依據、延後數量、錯誤原因；不含公告內容", async () => {
  const secret = "機密標題與內文 0912-345-678";
  const announcements = Array.from({ length: 23 }, (_, index) => ({ id: `n${String(index).padStart(2, "0")}`, data: announcement({ title: secret, content: secret, deadlines: [{ date: `2026-08-${String(index + 1).padStart(2, "0")}`, label: secret }] }) }));
  announcements.push({ id: "keep", data: announcement({ retentionPolicy: "longTerm", title: secret }) });
  announcements.push({ id: "fail", data: announcement({ title: secret }) });
  const { reader } = fakeReader({ settings: { mode: "dryRun", note: secret }, announcements, followUps: { fail: new Error("deadline exceeded") } });
  const summary = retentionCleanupLogSummary(await runRetentionCleanup(reader, NOW));
  assert.equal(summary.runDate, "2027-01-20");
  assert.equal(summary.startedAtTaipei, "2027-01-20 09:00:00 (Asia/Taipei)");
  assert.equal(summary.startedAtUtc, "2027-01-20T01:00:00.000Z");
  assert.deepEqual([summary.status, summary.mode, summary.requestedMode], ["dryRun", "dryRun", "dryRun"]);
  assert.deepEqual([summary.scanned, summary.eligible, summary.skipped, summary.deferredCount], [25, 23, 2, 3]);
  assert.equal(summary.wouldDeleteToday.length, 20);
  assert.deepEqual(Object.keys(summary.wouldDeleteToday[0]).sort(), ["baseCleanupDate", "basisDate", "category", "finalCleanupDate", "id", "latestUpdateDate", "protectionDate"]);
  assert.deepEqual(summary.skippedByReason, { retention_long_term: 1, follow_ups_unavailable: 1 });
  assert.equal(summary.errorCount, 1);
  assert.match(summary.errors[0], /followUps\/fail: deadline exceeded/);
  const text = JSON.stringify(summary);
  assert.equal(text.includes(secret), false, "日誌不得包含公告標題、內容或設定中的其他欄位");
  assert.equal(text.includes("機密"), false);
  assert.ok(Buffer.byteLength(text) < 64 * 1024, "單筆日誌大小遠低於 Cloud Logging 上限");
});

test("日誌摘要：錯誤最多 20 筆且每筆截斷；不合法的 mode 只記錄型別", () => {
  const report = { today: "2027-01-20", startedAt: "2027-01-19T16:30:00.000Z", status: "off" as const, mode: "off" as const, requestedMode: { nested: "物件" },
    maxDeletesPerRun: 20, scanned: 0, eligible: 0, wouldDeleteToday: [], deferred: [], skippedByReason: {}, decisions: [], errors: Array.from({ length: 30 }, (_, index) => `error ${index} ${"x".repeat(500)}`) };
  const summary = retentionCleanupLogSummary(report);
  assert.equal(summary.errorCount, 30);
  assert.equal(summary.errors.length, RETENTION_CLEANUP_LOG_MAX_ERRORS);
  assert.ok(summary.errors.every(message => message.length <= 200));
  assert.equal(summary.requestedMode, "(object)");
  assert.equal(summary.startedAtTaipei, "2027-01-20 00:30:00 (Asia/Taipei)", "UTC 16:30 為臺灣隔天 00:30");
  assert.equal(formatTaipeiDateTime(Date.parse("2026-12-31T15:59:59Z")), "2026-12-31 23:59:59");
  assert.equal(retentionCleanupLogSummary({ ...report, requestedMode: undefined }).requestedMode, "(missing)");
});
