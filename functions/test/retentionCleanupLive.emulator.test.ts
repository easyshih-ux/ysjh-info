// Gate 4B-4：正式刪除流程的 Emulator 測試（Firebase Admin SDK + 本機 Firestore／Storage Emulator）。
// 一般 `npm test` 沒有 Emulator 時自動略過；執行方式：
//   npx firebase emulators:exec --only firestore,storage --project demo-ysjh-info-rules-test "cd functions && npx tsx --test test/retentionCleanupLive.emulator.test.ts"
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defaultAnnouncementCleanup, permanentlyDeleteAnnouncement } from "../src/announcementDeletion.ts";
import { createFirestoreRetentionCleanupReader, runRetentionCleanup } from "../src/retentionCleanupJob.ts";
import { createRetentionDeleter } from "../src/retentionCleanupLive.ts";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && (process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST));
const PROJECT = "demo-ysjh-info-rules-test";
const TODAY = "2027-01-20";
const NOW = Date.parse("2027-01-20T01:00:00.000Z");
let app: App | undefined;
let db: Firestore;

if (enabled) {
  app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, "retention-live-emulator");
  db = getFirestore(app);
}
const bucket = () => getStorage(app).bucket();
const cleanup = () => ({
  cleanupSubcollections: defaultAnnouncementCleanup(db).cleanupSubcollections,
  cleanupStorage: async (id: string) => { await bucket().deleteFiles({ prefix: `announcements/${id}/` }); },
});
const announcement = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115, publishedAt: "2026-08-01T02:00:00.000Z", department: "設備組", title: "公告", content: "內容", publisherUid: "owner",
  publicationStatus: "published", retentionPolicy: "autoCleanup", importantEvents: [], deadlines: [{ date: "2026-09-01", label: "繳交" }], ...overrides,
});
async function seed(id: string, data: Record<string, unknown>, extra: { followUps?: Record<string, unknown>[]; lineNotices?: Record<string, unknown>[]; files?: string[] } = {}) {
  await db.doc(`announcements/${id}`).set(data);
  for (const [index, followUp] of (extra.followUps ?? []).entries()) await db.doc(`announcements/${id}/followUps/f${index}`).set(followUp);
  for (const [index, notice] of (extra.lineNotices ?? []).entries()) await db.doc(`announcements/${id}/lineNotices/n${index}`).set(notice);
  for (const file of extra.files ?? []) await bucket().file(`announcements/${id}/${file}`).save(Buffer.from("x"));
}
async function state(id: string) {
  const snapshot = await db.doc(`announcements/${id}`).get();
  const followUps = (await db.collection(`announcements/${id}/followUps`).get()).size;
  const lineNotices = (await db.collection(`announcements/${id}/lineNotices`).get()).size;
  const [files] = await bucket().getFiles({ prefix: `announcements/${id}/` });
  return { exists: snapshot.exists, data: snapshot.data(), followUps, lineNotices, files: files.length };
}
const oldFollowUp = { type: "supplement", status: "active", message: "x", authorUid: "owner", department: "設備組", createdAt: Timestamp.fromDate(new Date("2026-09-02T02:00:00Z")) };

beforeEach(async () => {
  if (!enabled) return;
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ prefix: "announcements/" }).catch(() => undefined);
});
after(async () => { if (app) await deleteApp(app); });

test("E1 live：到期公告連同子集合與 Storage 附件一起刪除；長期保留、催繳中、LINE 待處理、未到期公告完全不動", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  await seed("due", announcement(), { followUps: [oldFollowUp], lineNotices: [{ status: "sent" }], files: ["img-1.webp", "pdf/owner/p1.pdf"] });
  const untouched: Record<string, Record<string, unknown>> = {
    keep: announcement({ retentionPolicy: "longTerm" }),
    chase: announcement({ collectionStatus: "chasing" }),
    line: announcement(),
    future: announcement({ deadlines: [{ date: "2027-01-01", label: "x" }] }),
    unreviewed: announcement({ retentionPolicy: undefined }),
  };
  for (const [id, data] of Object.entries(untouched)) await seed(id, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)), { lineNotices: id === "line" ? [{ status: "pending" }] : [], files: ["img.webp"] });
  const before = Object.fromEntries(await Promise.all(Object.keys(untouched).map(async id => [id, await state(id)])));
  const report = await runRetentionCleanup(createFirestoreRetentionCleanupReader(db), NOW, { allowLive: true, deleter: createRetentionDeleter(db, { runId: "e1", cleanup: cleanup() }) });
  assert.equal(report.status, "live");
  assert.deepEqual(report.liveResults, [{ id: "due", outcome: "deleted", finalCleanupDate: "2026-12-15" }]);
  assert.deepEqual(await state("due"), { exists: false, data: undefined, followUps: 0, lineNotices: 0, files: 0 }, "主文件、子集合、附件全部刪除，沒有孤兒資料");
  for (const id of Object.keys(untouched)) assert.deepEqual(await state(id), before[id], `${id} 不得被修改`);
});

test("E2 單次上限：3 篇到期、上限 2 → 先刪最早到期的 2 篇；下一次執行再處理剩下的 1 篇", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live", maxDeletesPerRun: 2 });
  for (const [id, date] of [["a", "2026-08-01"], ["b", "2026-08-02"], ["c", "2026-08-03"]]) await seed(id, announcement({ deadlines: [{ date, label: "x" }] }));
  const first = await runRetentionCleanup(createFirestoreRetentionCleanupReader(db), NOW, { allowLive: true, deleter: createRetentionDeleter(db, { runId: "e2a", cleanup: cleanup() }) });
  assert.deepEqual(first.liveResults.map(result => `${result.id}:${result.outcome}`), ["a:deleted", "b:deleted"]);
  assert.deepEqual(first.deferred.map(item => item.id), ["c"]);
  assert.equal((await state("c")).exists, true);
  const second = await runRetentionCleanup(createFirestoreRetentionCleanupReader(db), NOW + 86_400_000, { allowLive: true, deleter: createRetentionDeleter(db, { runId: "e2b", cleanup: cleanup() }) });
  assert.deepEqual(second.liveResults.map(result => `${result.id}:${result.outcome}`), ["c:deleted"]);
});

test("E3 標記時重新判斷：掃描後改為長期保留、進入催繳、新增 LINE 待辦、人工刪除進行中 → 跳過且完全不寫入", { skip: !enabled }, async () => {
  const cases: Record<string, [Record<string, unknown>, Record<string, unknown>[]]> = {
    longTerm: [announcement({ retentionPolicy: "longTerm" }), []],
    chasing: [announcement({ collectionStatus: "chasing" }), []],
    pendingLine: [announcement(), [{ status: "pending" }]],
    manualDeleting: [announcement({ publicationStatus: "withdrawn", deletionStartedAt: Timestamp.now(), deletionStartedBy: "adminA" }), []],
  };
  for (const [id, [data, lineNotices]] of Object.entries(cases)) await seed(id, data, { lineNotices });
  const deleter = createRetentionDeleter(db, { runId: "e3", cleanup: cleanup() });
  for (const id of Object.keys(cases)) {
    const before = await state(id);
    const outcome = await deleter.deleteIfStillEligible(id, TODAY);
    assert.equal(outcome.outcome, "skipped_at_claim", id);
    assert.deepEqual(await state(id), before, `${id} 不得被寫入`);
  }
  assert.deepEqual(await deleter.deleteIfStillEligible("missing", TODAY), { id: "missing", outcome: "skipped_at_claim", reasons: ["missing"] });
});

test("E4 標記後驗證：標記後新增有效補充或 LINE 待辦 → 撤銷標記並恢復原本狀態，不刪除", { skip: !enabled }, async () => {
  await seed("addFollowUp", announcement(), { files: ["img.webp"] });
  await seed("addLine", announcement({ publicationStatus: "withdrawn", withdrawnAt: Timestamp.fromDate(new Date("2026-12-01T00:00:00Z")), withdrawnBy: "adminA" }));
  const original = { addFollowUp: (await state("addFollowUp")).data, addLine: (await state("addLine")).data };
  const deleter = createRetentionDeleter(db, {
    runId: "e4", cleanup: cleanup(),
    afterClaim: async id => {
      const marked = (await db.doc(`announcements/${id}`).get()).data();
      assert.equal(marked?.deletionStartedBy, "system:retention-cleanup:e4", "標記後才觸發競爭");
      if (id === "addFollowUp") await db.doc(`announcements/${id}/followUps/new`).set({ ...oldFollowUp, createdAt: Timestamp.fromDate(new Date("2027-01-19T02:00:00Z")) });
      else await db.doc(`announcements/${id}/lineNotices/new`).set({ status: "pending" });
    },
  });
  const followResult = await deleter.deleteIfStillEligible("addFollowUp", TODAY);
  assert.equal(followResult.outcome, "race_unclaimed");
  assert.ok(followResult.outcome === "race_unclaimed" && followResult.reasons.includes("not_yet_due"));
  const lineResult = await deleter.deleteIfStillEligible("addLine", TODAY);
  assert.ok(lineResult.outcome === "race_unclaimed" && lineResult.reasons.includes("line_notice_pending"));
  const afterFollow = await state("addFollowUp");
  assert.deepEqual(afterFollow.data, original.addFollowUp, "恢復為原本的上架狀態，移除本次寫入的欄位");
  assert.deepEqual([afterFollow.followUps, afterFollow.files], [1, 1]);
  assert.deepEqual((await state("addLine")).data, original.addLine, "原本已下架者維持原下架時間與下架者");
});

test("E5 清理中途失敗：公告保留為已下架＋本次標記，該次執行停止；之後管理員可用共用刪除完成", { skip: !enabled }, async () => {
  await db.doc("systemSettings/retentionCleanup").set({ mode: "live" });
  await seed("first", announcement({ deadlines: [{ date: "2026-08-01", label: "x" }] }), { files: ["img.webp"] });
  await seed("second", announcement({ deadlines: [{ date: "2026-08-02", label: "x" }] }));
  const failingCleanup = { ...cleanup(), cleanupStorage: async () => { throw new Error("storage unavailable"); } };
  const report = await runRetentionCleanup(createFirestoreRetentionCleanupReader(db), NOW, { allowLive: true, deleter: createRetentionDeleter(db, { runId: "e5", cleanup: failingCleanup }) });
  assert.deepEqual(report.liveResults, [{ id: "first", outcome: "failed", stage: "delete", message: "storage unavailable" }]);
  assert.deepEqual(report.notAttempted, ["second"]);
  const kept = await state("first");
  assert.equal(kept.exists, true);
  assert.equal(kept.data?.publicationStatus, "withdrawn");
  assert.equal(kept.data?.deletionStartedBy, "system:retention-cleanup:e5");
  assert.equal((await state("second")).data?.deletionStartedAt, undefined, "未處理的公告不得被標記");
  // 下一次排程：刪除中的公告一律跳過，交由管理員處理。
  const next = await createRetentionDeleter(db, { runId: "e5b", cleanup: cleanup() }).deleteIfStillEligible("first", TODAY);
  assert.ok(next.outcome === "skipped_at_claim" && next.reasons.includes("deletion_in_progress"));
  // 管理員以共用刪除函式完成清理（與「永久刪除」按鈕相同流程）。
  await permanentlyDeleteAnnouncement({ firestore: db, announcementId: "first", actor: "adminA", authorize: async () => {}, cleanup: cleanup() });
  assert.deepEqual(await state("first"), { exists: false, data: undefined, followUps: 0, lineNotices: 0, files: 0 });
});

test("E6 兩次執行同時處理同一篇：只會刪除一次，另一次安全跳過、不報錯", { skip: !enabled }, async () => {
  await seed("shared", announcement(), { followUps: [oldFollowUp], files: ["img.webp"] });
  const [a, b] = await Promise.all([
    createRetentionDeleter(db, { runId: "e6a", cleanup: cleanup() }).deleteIfStillEligible("shared", TODAY),
    createRetentionDeleter(db, { runId: "e6b", cleanup: cleanup() }).deleteIfStillEligible("shared", TODAY),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["deleted", "skipped_at_claim"], JSON.stringify([a, b]));
  assert.deepEqual(await state("shared"), { exists: false, data: undefined, followUps: 0, lineNotices: 0, files: 0 });
});

test("E7 dryRun 與被拒絕的 live：不寫入、不刪除任何資料", { skip: !enabled }, async () => {
  await seed("due", announcement(), { files: ["img.webp"] });
  const before = await state("due");
  for (const [settings, options] of [[{ mode: "dryRun" }, { allowLive: true, deleter: createRetentionDeleter(db, { runId: "e7a", cleanup: cleanup() }) }], [{ mode: "live" }, {}], [{ mode: "live" }, { allowLive: false, deleter: createRetentionDeleter(db, { runId: "e7b", cleanup: cleanup() }) }]] as const) {
    await db.doc("systemSettings/retentionCleanup").set(settings);
    const report = await runRetentionCleanup(createFirestoreRetentionCleanupReader(db), NOW, options);
    assert.deepEqual(report.liveResults, []);
    assert.deepEqual(await state("due"), before, JSON.stringify(settings));
  }
});
