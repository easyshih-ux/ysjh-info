// 方案 C Gate 5：執行紀錄的 Emulator 測試（Firebase Admin SDK + 本機 Firestore／Storage Emulator）。
// 一般 `npm test` 沒有 Emulator 時自動略過；執行方式：
//   npx firebase emulators:exec --only firestore,storage --project demo-ysjh-info-rules-test "cd functions && npx tsx --test test/retentionCleanupRuns.emulator.test.ts"
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defaultAnnouncementCleanup } from "../src/announcementDeletion.ts";
import { createFirestoreRetentionCleanupReader } from "../src/retentionCleanupJob.ts";
import { createRetentionDeleter } from "../src/retentionCleanupLive.ts";
import { createFirestoreRetentionRunWriter, recordRetentionCleanupRun, type RetentionRunRecordWriter } from "../src/retentionCleanupRunRecord.ts";
import { runScheduledRetentionCleanup } from "../src/retentionCleanupSchedule.ts";
import { createRetentionStatusCache, getRetentionCleanupStatusHandler } from "../src/retentionCleanupStatus.ts";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && (process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST));
const PROJECT = "demo-ysjh-info-rules-test";
const NOW = Date.parse("2027-01-19T19:00:05.123Z"); // 臺灣 2027-01-20 03:00:05
const RUN_ID = "2027-01-19T19-00-05.123Z";
let app: App | undefined;
let db: Firestore;
if (enabled) {
  app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, "retention-runs-emulator");
  db = getFirestore(app);
}
const bucket = () => getStorage(app).bucket();
const announcement = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115, publishedAt: "2026-08-01T02:00:00.000Z", department: "設備組", title: "公告標題", content: "公告內文", publisherUid: "owner",
  publicationStatus: "published", retentionPolicy: "autoCleanup", importantEvents: [], deadlines: [{ date: "2026-09-01", label: "繳交" }], ...overrides,
});
const silent = { log: () => undefined, error: () => undefined };
function capture() {
  const lines: { level: string; label: string; payload: string }[] = [];
  return { lines, logger: { log: (label: unknown, payload: unknown) => lines.push({ level: "log", label: String(label), payload: String(payload) }), error: (label: unknown, payload: unknown) => lines.push({ level: "error", label: String(label), payload: String(payload) }) } };
}
function cleanup(failStorageFor?: string) {
  return {
    cleanupSubcollections: defaultAnnouncementCleanup(db).cleanupSubcollections,
    cleanupStorage: async (id: string) => {
      if (id === failStorageFor) throw new Error("simulated storage outage");
      await bucket().deleteFiles({ prefix: `announcements/${id}/` });
    },
  };
}
async function scheduled(options: { failStorageFor?: string; writer?: RetentionRunRecordWriter; logger?: typeof silent } = {}) {
  return runScheduledRetentionCleanup({
    reader: createFirestoreRetentionCleanupReader(db), now: NOW,
    deleter: createRetentionDeleter(db, { runId: new Date(NOW).toISOString(), cleanup: cleanup(options.failStorageFor) }),
    writer: options.writer ?? createFirestoreRetentionRunWriter(db), logger: options.logger ?? silent, clock: () => NOW + 3_000,
  });
}
const runs = async () => (await db.collection("retentionCleanupRuns").get()).docs.map(document => ({ id: document.id, data: document.data() }));
const status = (uid: string | null) => getRetentionCleanupStatusHandler({ auth: uid ? { uid } : null, data: { refresh: true } }, { firestore: db, cache: createRetentionStatusCache(), now: () => NOW + 60_000 });

beforeEach(async () => {
  if (!enabled) return;
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ prefix: "announcements/" }).catch(() => undefined);
  await db.doc("authorizedPublishers/adminA").set({ role: "systemAdmin", enabled: true });
  await db.doc("authorizedPublishers/userA").set({ role: "publisher", enabled: true });
});
after(async () => { if (app) await deleteApp(app); });

test("GE1 live 成功：刪除到期公告並寫入一筆紀錄（Timestamp 到期時間、無標題內文）；監控 callable 讀得到", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  await db.doc("announcements/due").set(announcement());
  await bucket().file("announcements/due/img.webp").save(Buffer.from("x"));
  await db.doc("announcements/keep").set(announcement({ retentionPolicy: "longTerm" }));
  const { report, record } = await scheduled();
  assert.deepEqual(record, { status: "written", documentId: RUN_ID });
  assert.equal((await db.doc("announcements/due").get()).exists, false);
  assert.equal((await db.doc("announcements/keep").get()).exists, true);
  const [saved] = await runs();
  assert.equal(saved.id, RUN_ID);
  assert.equal(saved.data.result, "completed");
  assert.deepEqual(saved.data.liveCounts, { deleted: 1, skippedAtClaim: 0, raceUnclaimed: 0, failed: 0, notAttempted: 0 });
  assert.ok(saved.data.expiresAt instanceof Timestamp, "expiresAt 存為 Timestamp（TTL 需要）");
  assert.equal(saved.data.expiresAt.toMillis(), Date.parse(report.startedAt) + 90 * 86_400_000);
  assert.doesNotMatch(JSON.stringify(saved.data), /公告標題|公告內文/);
  const result = await status("adminA");
  assert.equal(result.runs.length, 1);
  assert.deepEqual({ id: result.runs[0].id, mode: result.runs[0].mode, result: result.runs[0].result, deleted: result.runs[0].deleted, failed: result.runs[0].failed, scanned: result.runs[0].scanned }, { id: RUN_ID, mode: "live", result: "completed", deleted: 1, failed: 0, scanned: 2 });
  assert.deepEqual(result.runs[0].results, [{ id: "due", outcome: "deleted" }]);
});

test("GE2 dryRun 與 GE3 off：各寫入一筆紀錄，公告完全不動", { skip: !enabled }, async () => {
  await db.doc("announcements/due").set(announcement());
  for (const [mode, expectedScanned] of [["dryRun", 1], ["off", 0]] as const) {
    await db.doc("systemSettings/retentionCleanup").set({ mode });
    for (const document of (await db.collection("retentionCleanupRuns").get()).docs) await document.ref.delete();
    const before = (await db.doc("announcements/due").get()).updateTime.toMillis();
    await scheduled();
    assert.equal((await db.doc("announcements/due").get()).updateTime.toMillis(), before, `${mode} 不修改公告`);
    const all = await runs();
    assert.equal(all.length, 1, mode);
    assert.equal(all[0].data.status, mode);
    assert.equal(all[0].data.scanned, expectedScanned);
    assert.equal("liveCounts" in all[0].data, false);
  }
});

test("GE4 沒有符合資格的公告：仍寫入紀錄，計數為 0", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  await db.doc("announcements/future").set(announcement({ deadlines: [{ date: "2027-06-01", label: "x" }] }));
  await scheduled();
  const [saved] = await runs();
  assert.equal(saved.data.eligible, 0);
  assert.equal(saved.data.liveCounts.deleted, 0);
  assert.equal(saved.data.result, "completed");
});

test("GE5 部分刪除失敗：成功、失敗、未處理數量如實記錄；失敗後停止的既有保護不變", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  // 依最終清理日期排序：a（最早）→ b（失敗）→ c（未處理）
  await db.doc("announcements/a").set(announcement({ deadlines: [{ date: "2026-08-20", label: "x" }] }));
  await db.doc("announcements/b").set(announcement({ deadlines: [{ date: "2026-08-25", label: "x" }] }));
  await db.doc("announcements/c").set(announcement({ deadlines: [{ date: "2026-09-01", label: "x" }] }));
  const { report } = await scheduled({ failStorageFor: "b" });
  assert.deepEqual(report.liveResults.map(result => [result.id, result.outcome]), [["a", "deleted"], ["b", "failed"]]);
  assert.equal((await db.doc("announcements/c").get()).exists, true, "失敗後不再處理下一篇");
  const [saved] = await runs();
  assert.equal(saved.data.result, "stoppedAfterFailure");
  assert.deepEqual(saved.data.liveCounts, { deleted: 1, skippedAtClaim: 0, raceUnclaimed: 0, failed: 1, notAttempted: 1 });
  assert.deepEqual(saved.data.notAttempted, ["c"]);
  const result = await status("adminA");
  assert.equal(result.runs[0].failed, 1);
  assert.equal(result.runs[0].deleted, 1);
  assert.equal(result.runs[0].result, "stoppedAfterFailure", "callable 原樣傳回結果，不改寫");
});

test("GE6 紀錄寫入失敗：清理照常完成、不重新刪除、不寫入任何紀錄，錯誤寫入日誌", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  await db.doc("announcements/due").set(announcement());
  const real = createFirestoreRetentionRunWriter(db);
  const failing: RetentionRunRecordWriter = { create: async () => { throw Object.assign(new Error("14 UNAVAILABLE: simulated"), { code: 14 }); }, read: real.read };
  const log = capture();
  const { report, record } = await scheduled({ writer: failing, logger: log.logger });
  assert.equal(record.status, "failed");
  assert.deepEqual(report.liveResults.map(result => result.outcome), ["deleted"]);
  assert.equal((await db.doc("announcements/due").get()).exists, false);
  assert.deepEqual(await runs(), []);
  assert.ok(log.lines.some(line => line.level === "error" && line.label === "retention-cleanup-run-record-failed"));
});

test("GE7 重複寫入：真實 Firestore create() 不覆蓋；同一次執行回報 duplicate，不同內容改用 -2", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "dryRun" });
  await db.doc("announcements/due").set(announcement());
  const { report } = await scheduled();
  const writer = createFirestoreRetentionRunWriter(db);
  const firstUpdate = (await db.doc(`retentionCleanupRuns/${RUN_ID}`).get()).updateTime.toMillis();
  assert.deepEqual(await recordRetentionCleanupRun(writer, report, NOW + 999_000, silent), { status: "duplicate", documentId: RUN_ID });
  assert.equal((await db.doc(`retentionCleanupRuns/${RUN_ID}`).get()).updateTime.toMillis(), firstUpdate, "原紀錄未被改寫");
  assert.deepEqual(await recordRetentionCleanupRun(writer, { ...report, eligible: 0, wouldDeleteToday: [] }, NOW, silent), { status: "written", documentId: `${RUN_ID}-2` });
  assert.deepEqual((await runs()).map(run => run.id).sort(), [RUN_ID, `${RUN_ID}-2`]);
  assert.equal((await db.doc(`retentionCleanupRuns/${RUN_ID}`).get()).updateTime.toMillis(), firstUpdate);
});

test("GE8 權限：非 systemAdmin、未登入、不存在帳號都無法取得紀錄", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "dryRun" });
  await scheduled();
  for (const [uid, code] of [["userA", "permission-denied"], [null, "unauthenticated"], ["stranger", "permission-denied"]] as const) {
    await assert.rejects(status(uid), (error: { code?: string }) => error.code === code, String(uid));
  }
});

test("GE9 清理直接拋出例外：真實 Firestore 寫入 failed 紀錄（數量 null），原始例外重新拋出，公告完全不動；監控 callable 讀到 null", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  await db.doc("announcements/due").set(announcement());
  const before = (await db.doc("announcements/due").get()).updateTime.toMillis();
  const real = createFirestoreRetentionCleanupReader(db);
  const log = capture();
  let thrown: unknown;
  await runScheduledRetentionCleanup({
    reader: { ...real, listAnnouncements: async () => null as never }, now: NOW,
    deleter: createRetentionDeleter(db, { runId: new Date(NOW).toISOString(), cleanup: cleanup() }),
    writer: createFirestoreRetentionRunWriter(db), logger: log.logger, clock: () => NOW + 1_000,
  }).catch(error => { thrown = error; });
  assert.ok(thrown instanceof TypeError, "原始例外重新拋出");
  assert.equal((await db.doc("announcements/due").get()).updateTime.toMillis(), before, "公告未被標記或刪除");
  const [saved] = await runs();
  assert.equal(saved.id, RUN_ID);
  assert.equal(saved.data.result, "failed");
  assert.equal(saved.data.crashed, true);
  for (const field of ["scanned", "eligible", "skipped", "deferredCount"]) assert.equal(saved.data[field], null, field);
  assert.ok(saved.data.expiresAt instanceof Timestamp);
  assert.ok(log.lines.some(line => line.level === "error" && line.label === "retention-cleanup-run-crashed"));
  const result = await status("adminA");
  assert.deepEqual({ result: result.runs[0].result, scanned: result.runs[0].scanned, deleted: result.runs[0].deleted, failed: result.runs[0].failed, skipped: result.runs[0].skipped }, { result: "failed", scanned: null, deleted: null, failed: null, skipped: null });
});
