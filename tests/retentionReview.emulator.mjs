// Gate 3B：舊公告保存方式批次審查（Firestore Emulator，套用正式 firestore.rules）。
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { applyRetentionPolicyBatch, readRetentionReviewData } from "../lib/retentionReviewFirestore.ts";

let testEnvironment;

before(async () => {
  const match = (process.env.FIRESTORE_EMULATOR_HOST ?? "").match(/^(127\.0\.0\.1|localhost):(\d+)$/);
  if (!match) throw new Error("Rules tests require a local FIRESTORE_EMULATOR_HOST.");
  testEnvironment = await initializeTestEnvironment({
    projectId: "demo-ysjh-info-rules-test",
    firestore: { host: match[1], port: Number(match[2]), rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
afterEach(async () => { await testEnvironment.clearFirestore(); });
after(async () => { await testEnvironment.cleanup(); });

const userDb = uid => testEnvironment.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
const profile = (role, enabled = true) => ({ role, enabled, email: "seed@example.test", defaultDepartment: "設備組" });
const announcement = (overrides = {}) => ({
  academicYear: 114, publishedAt: "2025-10-01T00:00:00.000Z", department: "設備組", title: "舊公告", audiences: ["全校教師"], content: "內容",
  publisherUid: "userA", publicationStatus: "published", importantEvents: [], deadlines: [], attachments: [], links: [], followUps: [],
  updatedAt: "2025-10-01T00:00:00.000Z", contentUpdatedAt: "2025-10-02T00:00:00.000Z", contentUpdateCount: 3,
  lineNotificationLevel: "task", collectionStatus: "chasing", collectionMessage: "請繳交", ...overrides,
});
const withDeadline = (overrides = {}) => announcement({ deadlines: [{ date: "2025-10-20", label: "繳交" }], ...overrides });

async function seed(entries) {
  await testEnvironment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await setDoc(doc(database, "authorizedPublishers/adminA"), profile("systemAdmin"));
    await setDoc(doc(database, "authorizedPublishers/userA"), profile("publisher"));
    await setDoc(doc(database, "authorizedPublishers/userB"), profile("publisher"));
    await setDoc(doc(database, "authorizedPublishers/disabledAdmin"), profile("systemAdmin", false));
    for (const [id, data] of Object.entries(entries)) await setDoc(doc(database, `announcements/${id}`), data);
  });
}
async function readAll(ids) {
  const result = {};
  await testEnvironment.withSecurityRulesDisabled(async context => {
    for (const id of ids) { const snapshot = await getDoc(doc(context.firestore(), `announcements/${id}`)); result[id] = snapshot.exists() ? snapshot.data() : null; }
  });
  return result;
}
const byId = outcomes => Object.fromEntries(outcomes.map(outcome => [outcome.id, outcome.status === "success" ? "success" : `${outcome.status}:${outcome.reason}`]));
const withoutRetention = data => { const copy = { ...data }; delete copy.retentionPolicy; return copy; };

test("G1 systemAdmin 批次設定自動清理：只更新有期限者，其餘依原因略過，且只修改 retentionPolicy", async () => {
  const entries = {
    dated114: withDeadline(),
    datedEvent: announcement({ academicYear: 112, importantEvents: [{ date: "2024-03-01", endDate: "2024-03-05", title: "研習" }] }),
    undated: announcement(),
    badDate: announcement({ importantEvents: [{ date: "2025-10-01", endDate: "2025-13-01", title: "壞日期" }] }),
    reviewed: withDeadline({ retentionPolicy: "longTerm" }),
    deleting: withDeadline({ deletionStartedAt: "2026-11-06T00:00:00.000Z", publicationStatus: "withdrawn" }),
    withdrawn: withDeadline({ publicationStatus: "withdrawn", withdrawnAt: "2026-01-01T00:00:00.000Z", withdrawnBy: "adminA" }),
  };
  await seed(entries);
  const ids = [...Object.keys(entries), "missing"];
  const outcomes = await applyRetentionPolicyBatch(userDb("adminA"), "adminA", ids, "autoCleanup");
  assert.deepEqual(byId(outcomes), {
    dated114: "success", datedEvent: "success", withdrawn: "success",
    undated: "skipped:noValidDate", badDate: "skipped:noValidDate", reviewed: "skipped:alreadyReviewed", deleting: "skipped:deleting", missing: "skipped:missing",
  });
  const after = await readAll(ids);
  for (const id of ["dated114", "datedEvent", "withdrawn"]) {
    assert.equal(after[id].retentionPolicy, "autoCleanup");
    assert.deepEqual(withoutRetention(after[id]), entries[id], `${id} 其他欄位必須完全不變`);
  }
  for (const id of ["undated", "badDate", "reviewed", "deleting"]) assert.deepEqual(after[id], entries[id], `${id} 不得被修改`);
  assert.equal(after.missing, null, "不存在的公告不得被建立");
});

test("G2 無期限與日期異常的公告可以批次設定長期保留", async () => {
  await seed({ undated: announcement(), badDate: announcement({ deadlines: [{ date: "11/13", label: "x" }] }), dated: withDeadline() });
  const outcomes = await applyRetentionPolicyBatch(userDb("adminA"), "adminA", ["undated", "badDate", "dated"], "longTerm");
  assert.deepEqual(byId(outcomes), { undated: "success", badDate: "success", dated: "success" });
  const after = await readAll(["undated", "badDate", "dated"]);
  for (const value of Object.values(after)) assert.equal(value.retentionPolicy, "longTerm");
});

test("G3 一般 publisher 與停用的管理員無法使用批次功能；publisher 也無法直接批次改寫他人公告", async () => {
  await seed({ own: withDeadline(), others: withDeadline({ publisherUid: "userB" }) });
  for (const uid of ["userA", "disabledAdmin"]) {
    const outcomes = await applyRetentionPolicyBatch(userDb(uid), uid, ["own", "others"], "longTerm");
    assert.deepEqual(byId(outcomes), { own: "failed:notAdmin", others: "failed:notAdmin" });
  }
  // 繞過前端與交易檢查，直接寫入仍由 Firestore Rules 拒絕。
  const database = userDb("userA");
  const batch = writeBatch(database);
  batch.update(doc(database, "announcements/others"), { retentionPolicy: "longTerm" });
  await assertFails(batch.commit());
  const after = await readAll(["own", "others"]);
  assert.equal("retentionPolicy" in after.own, false);
  assert.equal("retentionPolicy" in after.others, false);
});

test("G4 重複送出不會重複修改：第二次全部略過且資料不變", async () => {
  await seed({ a: withDeadline(), b: announcement() });
  const first = await applyRetentionPolicyBatch(userDb("adminA"), "adminA", ["a", "b"], "longTerm");
  assert.deepEqual(byId(first), { a: "success", b: "success" });
  const snapshot = await readAll(["a", "b"]);
  const second = await applyRetentionPolicyBatch(userDb("adminA"), "adminA", ["a", "b"], "autoCleanup");
  assert.deepEqual(byId(second), { a: "skipped:alreadyReviewed", b: "skipped:alreadyReviewed" });
  assert.deepEqual(await readAll(["a", "b"]), snapshot);
});

test("G5 清單讀取後，發布者已自行設定的公告不會被管理員覆蓋", async () => {
  await seed({ race: withDeadline(), other: withDeadline({ academicYear: 113 }) });
  const listed = await readRetentionReviewData(userDb("adminA"));
  assert.deepEqual(listed.items.map(item => item.id).sort(), ["other", "race"]);
  await updateDoc(doc(userDb("userA"), "announcements/race"), { retentionPolicy: "longTerm" });
  const outcomes = await applyRetentionPolicyBatch(userDb("adminA"), "adminA", ["race", "other"], "autoCleanup");
  assert.deepEqual(byId(outcomes), { race: "skipped:alreadyReviewed", other: "success" });
  const after = await readAll(["race", "other"]);
  assert.equal(after.race.retentionPolicy, "longTerm");
  assert.equal(after.other.retentionPolicy, "autoCleanup");
});

test("G6 部分失敗：某篇舊資料無法通過 Rules 時，同批其他公告仍完成，失敗者列為可重試且未被修改", async () => {
  const broken = withDeadline({ lineNotificationLevel: "urgent" });
  await seed({ a: withDeadline(), b: withDeadline(), broken, d: withDeadline() });
  const outcomes = await applyRetentionPolicyBatch(userDb("adminA"), "adminA", ["a", "b", "broken", "d"], "autoCleanup", { chunkSize: 2 });
  assert.deepEqual(byId(outcomes), { a: "success", b: "success", broken: "failed:writeFailed", d: "success" });
  const after = await readAll(["a", "b", "broken", "d"]);
  assert.deepEqual(after.broken, broken);
  for (const id of ["a", "b", "d"]) assert.equal(after[id].retentionPolicy, "autoCleanup");
});

test("G7 超過一批（120 篇，每批 50）全部完成，交易分批不受 Rules 讀取上限影響", async () => {
  const entries = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`n${index}`, index % 2 ? withDeadline() : announcement()]));
  await seed(entries);
  const outcomes = await applyRetentionPolicyBatch(userDb("adminA"), "adminA", Object.keys(entries), "longTerm");
  assert.equal(outcomes.length, 120);
  assert.ok(outcomes.every(outcome => outcome.status === "success"));
});

test("G8 清單讀取：不限學年度、包含已下架、排除刪除中、格式異常計入無法列出數量", async () => {
  await seed({
    y111: announcement({ academicYear: 111 }),
    y115: withDeadline({ academicYear: 115 }),
    withdrawn: announcement({ publicationStatus: "withdrawn" }),
    deleting: announcement({ deletionStartedAt: "2026-11-06T00:00:00.000Z" }),
    reviewed: announcement({ retentionPolicy: "autoCleanup" }),
    broken: announcement({ title: "" }),
  });
  const data = await readRetentionReviewData(userDb("adminA"));
  assert.deepEqual(data.items.map(item => item.id).sort(), ["withdrawn", "y111", "y115"]);
  assert.equal(data.unlistableCount, 1);
  assert.equal(data.deletingCount, 1);
  assert.equal(data.reviewedCount, 1);
  assert.equal(data.totalCount, 6);
  assert.equal(data.items.length + data.unlistableCount + data.reviewedCount + data.deletingCount, data.totalCount);
});

test("G9 登入失效（無法讀取操作者資料）：立即停止，不逐篇重試，未修改任何公告", async () => {
  await seed({ a: withDeadline(), b: withDeadline(), c: withDeadline() });
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const outcomes = await applyRetentionPolicyBatch(anonymous, "adminA", ["a", "b", "c"], "longTerm", { chunkSize: 2 });
  assert.deepEqual(byId(outcomes), { a: "failed:signedOut", b: "failed:signedOut", c: "failed:notProcessed" });
  const after = await readAll(["a", "b", "c"]);
  for (const value of Object.values(after)) assert.equal("retentionPolicy" in value, false);
});

test("G10 沒有管理員資料的帳號：列為權限不足，後續批次不再嘗試，未修改任何公告", async () => {
  await seed({ a: withDeadline(), b: withDeadline(), c: withDeadline() });
  const outcomes = await applyRetentionPolicyBatch(userDb("stranger"), "stranger", ["a", "b", "c"], "longTerm", { chunkSize: 2 });
  assert.deepEqual(byId(outcomes), { a: "failed:notAdmin", b: "failed:notAdmin", c: "failed:notAdmin" });
  const after = await readAll(["a", "b", "c"]);
  for (const value of Object.values(after)) assert.equal("retentionPolicy" in value, false);
});
