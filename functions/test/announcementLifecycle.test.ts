import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { cleanupFailedAnnouncementUploadHandler, manageAnnouncementLifecycleHandler } from "../src/index.ts";

type Data = Record<string, unknown>;
function store(initial: Record<string, Data>) {
  const docs = new Map(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  const firestore = {
    collection(name: string) { return { doc(id: string) { const path = `${name}/${id}`; return { path, async get() { const value = docs.get(path); return { exists: value !== undefined, data: () => value && structuredClone(value) }; } }; } }; },
    async runTransaction<T>(run: (transaction: unknown) => Promise<T>) {
      const writes: Array<() => void> = [];
      const transaction = {
        async get(ref: { path: string }) { const value = docs.get(ref.path); return { exists: value !== undefined, data: () => value && structuredClone(value) }; },
        update(ref: { path: string }, patch: Data) { writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...patch })); },
        delete(ref: { path: string }) { writes.push(() => docs.delete(ref.path)); },
      };
      const result = await run(transaction); writes.forEach(write => write()); return result;
    },
  } as unknown as Firestore;
  return { firestore, get: (path: string) => docs.get(path) };
}
const profile = (role: "publisher" | "systemAdmin", enabled = true) => ({ role, enabled });
const announcement = (publisherUid = "owner", extra: Data = {}) => ({ publisherUid, publicationStatus: "published", deadlines: [{ date: "2026-09-20", label: "截止" }], ...extra });
const request = (uid: string, action: string, data: Data = {}) => ({ auth: uid ? { uid } : null, data: { announcementId: "a1", action, ...data } });
const noSubcollections = async () => {};
async function denied(promise: Promise<unknown>) { await assert.rejects(promise, error => (error as { code?: string }).code === "permission-denied"); }

test("Storage cleanup 僅使用目標公告 prefix，失敗上傳另核對 uploader UID", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /deleteFiles\(\{ prefix: `announcements\/\$\{announcementId\}\/` \}\)/);
  assert.match(source, /getFiles\(\{ prefix: `announcements\/\$\{announcementId\}\/` \}\)/);
  assert.match(source, /metadata\.metadata\?\.uploaderUid === uploaderUid/);
  assert.match(source, /file\.delete\(\{ ignoreNotFound: true \}\)/);
});

test("enabled publisher 可下架與復原自己的公告", async () => {
  const value = store({ "authorizedPublishers/owner": profile("publisher"), "announcements/a1": announcement() });
  await manageAnnouncementLifecycleHandler(request("owner", "withdraw"), value.firestore);
  assert.equal(value.get("announcements/a1")?.publicationStatus, "withdrawn");
  await manageAnnouncementLifecycleHandler(request("owner", "restore"), value.firestore);
  assert.equal(value.get("announcements/a1")?.publicationStatus, "published");
});
test("publisher 不可操作別人公告，同單位也不例外", async () => {
  const value = store({ "authorizedPublishers/other": profile("publisher"), "announcements/a1": announcement("owner", { department: "設備組" }) });
  await denied(manageAnnouncementLifecycleHandler(request("other", "withdraw"), value.firestore));
  assert.equal(value.get("announcements/a1")?.publicationStatus, "published");
});
test("disabled publisher 不可操作", async () => {
  const value = store({ "authorizedPublishers/owner": profile("publisher", false), "announcements/a1": announcement() });
  await denied(manageAnnouncementLifecycleHandler(request("owner", "withdraw"), value.firestore));
});
test("systemAdmin 可管理全校公告", async () => {
  const value = store({ "authorizedPublishers/admin": profile("systemAdmin"), "announcements/a1": announcement("owner") });
  await manageAnnouncementLifecycleHandler(request("admin", "withdraw"), value.firestore);
  assert.equal(value.get("announcements/a1")?.publicationStatus, "withdrawn");
});
test("永久刪除僅 systemAdmin", async () => {
  const publisherStore = store({ "authorizedPublishers/owner": profile("publisher"), "announcements/a1": announcement() });
  let cleanupCount = 0;
  const cleanup = async () => { cleanupCount += 1; };
  await denied(manageAnnouncementLifecycleHandler(request("owner", "delete"), publisherStore.firestore, cleanup, noSubcollections));
  assert.ok(publisherStore.get("announcements/a1"));
  assert.equal(cleanupCount, 0);
  const adminStore = store({ "authorizedPublishers/admin": profile("systemAdmin"), "announcements/a1": announcement() });
  await manageAnnouncementLifecycleHandler(request("admin", "delete"), adminStore.firestore, cleanup, noSubcollections);
  assert.equal(adminStore.get("announcements/a1"), undefined);
  assert.equal(cleanupCount, 1);
});
test("永久刪除在附件目錄不存在或重試時仍可成功", async () => {
  const value = store({ "authorizedPublishers/admin": profile("systemAdmin"), "announcements/a1": announcement() });
  const cleaned: string[] = [];
  const cleanup = async (announcementId: string) => { cleaned.push(announcementId); };
  await manageAnnouncementLifecycleHandler(request("admin", "delete"), value.firestore, cleanup, noSubcollections);
  await manageAnnouncementLifecycleHandler(request("admin", "delete"), value.firestore, cleanup, noSubcollections);
  assert.deepEqual(cleaned, ["a1", "a1"]);
  assert.equal(value.get("announcements/a1"), undefined);
});
test("下架與復原不清除附件", async () => {
  const value = store({ "authorizedPublishers/admin": profile("systemAdmin"), "announcements/a1": announcement() });
  let cleanupCount = 0;
  const cleanup = async () => { cleanupCount += 1; };
  await manageAnnouncementLifecycleHandler(request("admin", "withdraw"), value.firestore, cleanup);
  await manageAnnouncementLifecycleHandler(request("admin", "restore"), value.firestore, cleanup);
  assert.equal(cleanupCount, 0);
});
test("失敗上傳 cleanup 只清呼叫者指定公告目錄，且既有公告不清除", async () => {
  const value = store({ "authorizedPublishers/owner": profile("publisher") });
  const cleaned: Array<[string, string]> = [];
  const cleanup = async (announcementId: string, uid: string) => { cleaned.push([announcementId, uid]); };
  const result = await cleanupFailedAnnouncementUploadHandler(
    { auth: { uid: "owner" }, data: { announcementId: "failed-a1" } },
    value.firestore,
    cleanup,
  );
  assert.deepEqual(result, { success: true, cleaned: true });
  assert.deepEqual(cleaned, [["failed-a1", "owner"]]);

  const existing = store({ "authorizedPublishers/owner": profile("publisher"), "announcements/existing": announcement() });
  const existingResult = await cleanupFailedAnnouncementUploadHandler(
    { auth: { uid: "owner" }, data: { announcementId: "existing" } },
    existing.firestore,
    cleanup,
  );
  assert.deepEqual(existingResult, { success: true, cleaned: false, reason: "announcement-exists" });
  assert.deepEqual(cleaned, [["failed-a1", "owner"]]);
});
test("未授權帳號不能利用失敗上傳 cleanup 刪除附件", async () => {
  const value = store({ "authorizedPublishers/disabled": profile("publisher", false) });
  let cleanupCount = 0;
  await denied(cleanupFailedAnnouncementUploadHandler(
    { auth: { uid: "disabled" }, data: { announcementId: "a1" } },
    value.firestore,
    async () => { cleanupCount += 1; },
  ));
  assert.equal(cleanupCount, 0);
});
test("只有有期限公告可啟動催繳，並可結束", async () => {
  const value = store({ "authorizedPublishers/owner": profile("publisher"), "announcements/a1": announcement() });
  await manageAnnouncementLifecycleHandler(request("owner", "startChase", { message: "請儘速完成" }), value.firestore);
  assert.equal(value.get("announcements/a1")?.collectionStatus, "chasing");
  assert.equal(value.get("announcements/a1")?.collectionMessage, "請儘速完成");
  await manageAnnouncementLifecycleHandler(request("owner", "stopChase"), value.firestore);
  const noDeadline = store({ "authorizedPublishers/owner": profile("publisher"), "announcements/a1": announcement("owner", { deadlines: [] }) });
  await assert.rejects(manageAnnouncementLifecycleHandler(request("owner", "startChase", { message: "" }), noDeadline.firestore), error => (error as { code?: string }).code === "failed-precondition");
});
test("催繳、下架與復原互相獨立", async () => {
  const value = store({ "authorizedPublishers/owner": profile("publisher"), "announcements/a1": announcement() });
  await manageAnnouncementLifecycleHandler(request("owner", "startChase", { message: "提醒" }), value.firestore);
  await manageAnnouncementLifecycleHandler(request("owner", "withdraw"), value.firestore);
  await manageAnnouncementLifecycleHandler(request("owner", "restore"), value.firestore);
  assert.equal(value.get("announcements/a1")?.publicationStatus, "published");
  assert.equal(value.get("announcements/a1")?.collectionStatus, "chasing");
});

test("永久刪除先下架並標記，再清子集合與 Storage，最後才刪公告文件", async () => {
  const value = store({ "authorizedPublishers/admin": profile("systemAdmin"), "announcements/a1": announcement() });
  const events: string[] = [];
  const snapshot = (label: string) => {
    const doc = value.get("announcements/a1");
    events.push(`${label}:${doc?.publicationStatus}:${doc?.deletionStartedAt ? "marked" : "unmarked"}`);
  };
  await manageAnnouncementLifecycleHandler(
    request("admin", "delete"), value.firestore,
    async () => { snapshot("storage"); },
    async ref => { assert.equal((ref as unknown as { path: string }).path, "announcements/a1"); snapshot("subcollections"); },
  );
  assert.deepEqual(events, [
    "subcollections:withdrawn:marked", "storage:withdrawn:marked", "subcollections:withdrawn:marked",
  ]);
  assert.equal(value.get("announcements/a1"), undefined);
});
test("清理中途失敗會保留已下架公告，重試可完成且不重設刪除標記", async () => {
  const value = store({ "authorizedPublishers/admin": profile("systemAdmin"), "announcements/a1": announcement() });
  await assert.rejects(
    manageAnnouncementLifecycleHandler(request("admin", "delete"), value.firestore, async () => { throw new Error("storage down"); }, noSubcollections),
    error => (error as { code?: string }).code === "internal" && /請再按一次「永久刪除」/.test(String((error as Error).message)),
  );
  const kept = value.get("announcements/a1");
  assert.equal(kept?.publicationStatus, "withdrawn");
  assert.ok(kept?.deletionStartedAt);
  await assert.rejects(
    manageAnnouncementLifecycleHandler(request("admin", "delete"), value.firestore, async () => {}, async () => { throw new Error("firestore down"); }),
    error => (error as { code?: string }).code === "internal",
  );
  assert.ok(value.get("announcements/a1"));
  await manageAnnouncementLifecycleHandler(request("admin", "delete"), value.firestore, async () => {}, noSubcollections);
  assert.equal(value.get("announcements/a1"), undefined);
});
test("刪除中的公告不可復原、重新上架、啟動或結束催繳", async () => {
  const value = store({
    "authorizedPublishers/admin": profile("systemAdmin"),
    "authorizedPublishers/owner": profile("publisher"),
    "announcements/a1": announcement("owner", { publicationStatus: "withdrawn", deletionStartedAt: "marked" }),
  });
  for (const [uid, action, data] of [["owner", "restore", {}], ["admin", "restore", {}], ["owner", "startChase", { message: "x" }], ["owner", "stopChase", {}], ["owner", "withdraw", {}]] as const) {
    await assert.rejects(
      manageAnnouncementLifecycleHandler(request(uid, action, data), value.firestore),
      error => (error as { code?: string }).code === "failed-precondition",
    );
  }
  assert.equal(value.get("announcements/a1")?.publicationStatus, "withdrawn");
});
test("預設子集合清理會列出全部子集合並遞迴刪除", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /announcementRef\.listCollections\(\)/);
  assert.match(source, /firestore\.recursiveDelete\(subcollection\)/);
});
