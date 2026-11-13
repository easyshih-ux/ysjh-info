// 自動清理監控（方案 C，Gate 2）：唯讀狀態查詢的 Emulator 測試（Firebase Admin SDK + 本機 Firestore Emulator）。
// 一般 `npm test` 沒有 Emulator 時自動略過；執行方式：
//   npx firebase emulators:exec --only firestore --project demo-ysjh-info-rules-test "cd functions && npx tsx --test test/retentionCleanupStatus.emulator.test.ts"
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { createRetentionStatusCache, getRetentionCleanupStatusHandler } from "../src/retentionCleanupStatus.ts";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const PROJECT = "demo-ysjh-info-rules-test";
const NOW = Date.parse("2027-01-20T01:00:00.000Z");
let app: App | undefined;
let db: Firestore;
if (enabled) {
  app = initializeApp({ projectId: PROJECT }, "retention-status-emulator");
  db = getFirestore(app);
}
const announcement = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115, publishedAt: "2026-08-01T02:00:00.000Z", department: "設備組", title: "公告", content: "內文", publisherUid: "owner",
  publicationStatus: "published", retentionPolicy: "autoCleanup", importantEvents: [], deadlines: [{ date: "2026-09-01", label: "繳交" }], ...overrides,
});

/** 所有文件（含子集合）的路徑與更新時間，用來證明查詢前後沒有任何寫入。 */
async function fingerprint() {
  const rows: string[] = [];
  async function walk(collections: FirebaseFirestore.CollectionReference[]) {
    for (const collection of collections) {
      for (const document of (await collection.get()).docs) {
        rows.push(`${document.ref.path}|${document.updateTime.toMillis()}`);
        await walk(await document.ref.listCollections());
      }
    }
  }
  await walk(await db.listCollections());
  return rows.sort();
}

beforeEach(async () => {
  if (!enabled) return;
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("authorizedPublishers/adminA").set({ role: "systemAdmin", enabled: true });
  await db.doc("authorizedPublishers/userA").set({ role: "publisher", enabled: true });
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  await db.doc("announcements/due").set(announcement({ title: "已到期公告" }));
  await db.doc("announcements/due/followUps/f1").set({ type: "supplement", status: "active", message: "x", createdAt: Timestamp.fromDate(new Date("2026-09-02T00:00:00Z")) });
  await db.doc("announcements/keep").set(announcement({ title: "長期保留公告", retentionPolicy: "longTerm" }));
  await db.doc("announcements/line").set(announcement({ title: "待通知公告" }));
  await db.doc("announcements/line/lineNotices/n1").set({ status: "pending" });
  await db.doc("retentionCleanupRuns/2027-01-19T19-00-05Z").set({ runDate: "2027-01-20", startedAtUtc: "2027-01-19T19:00:05.000Z", startedAtTaipei: "2027-01-20 03:00:05 (Asia/Taipei)", status: "live", mode: "live", scanned: 3, eligible: 1, skipped: 2, liveCounts: { deleted: 1, failed: 0 }, errorCount: 0, liveResults: [{ id: "old", outcome: "deleted" }] });
  await db.doc("retentionCleanupRuns/2027-01-18T19-00-05Z").set({ runDate: "2027-01-19", startedAtUtc: "2027-01-18T19:00:05.000Z", status: "live", mode: "live", scanned: 4, eligible: 0, skipped: 4, liveCounts: { deleted: 0, failed: 0 }, errorCount: 0, liveResults: [] });
});
after(async () => { if (app) await deleteApp(app); });

test("S1 systemAdmin：讀取真實資料計算預覽與執行紀錄，前後所有文件完全沒有寫入", { skip: !enabled }, async () => {
  const before = await fingerprint();
  const status = await getRetentionCleanupStatusHandler({ auth: { uid: "adminA" }, data: { refresh: true } }, { firestore: db, cache: createRetentionStatusCache(), now: () => NOW });
  assert.deepEqual(await fingerprint(), before, "查詢不得寫入任何文件");
  assert.equal(status.settings.mode, "live");
  assert.deepEqual(status.summary.wouldDeleteToday, ["due"]);
  const byId = Object.fromEntries(status.announcements.map(row => [row.id, row]));
  assert.equal(byId.due.title, "已到期公告");
  assert.equal(byId.due.eligible, true);
  assert.deepEqual(byId.keep.skipReasons, ["retention_long_term"]);
  assert.deepEqual(byId.line.skipReasons, ["line_notice_pending"]);
  assert.deepEqual(status.runs.map(run => run.runDate), ["2027-01-20", "2027-01-19"], "執行紀錄由新到舊");
  assert.deepEqual(status.runs[0].results, [{ id: "old", outcome: "deleted" }]);
  assert.deepEqual(status.errors, []);
});

test("S2 權限：一般發布者、未登入、不存在的帳號被拒絕，且不寫入任何文件", { skip: !enabled }, async () => {
  const before = await fingerprint();
  for (const [uid, code] of [["userA", "permission-denied"], [null, "unauthenticated"], ["stranger", "permission-denied"]] as const) {
    await assert.rejects(getRetentionCleanupStatusHandler({ auth: uid ? { uid } : null, data: {} }, { firestore: db, cache: createRetentionStatusCache(), now: () => NOW }), (error: { code?: string }) => error.code === code, String(uid));
  }
  assert.deepEqual(await fingerprint(), before);
});

test("S3 尚無執行紀錄集合時回傳空陣列，預覽照常", { skip: !enabled }, async () => {
  for (const document of (await db.collection("retentionCleanupRuns").get()).docs) await document.ref.delete();
  const status = await getRetentionCleanupStatusHandler({ auth: { uid: "adminA" }, data: {} }, { firestore: db, cache: createRetentionStatusCache(), now: () => NOW });
  assert.deepEqual(status.runs, []);
  assert.equal(status.summary.scanned, 3);
});
