import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { syncRelatedFollowUpSummaryChange } from "../src/followUpSummary.ts";

function createStore(options: { parent?: Record<string, unknown>; parentExists?: boolean; counts?: Partial<Record<"supplement" | "reminder" | "related", number>> } = {}) {
  const parent = { ...(options.parent ?? { title: "公告", contentUpdatedAt: "2026-09-22T10:00:00Z" }) };
  const writes: Record<string, unknown>[] = [];
  const firestore = {
    collection(name: string) {
      assert.equal(name, "announcements");
      return {
        doc() {
          return {
            async get() {
              return { exists: options.parentExists !== false, data: () => parent };
            },
            collection(name: string) {
              assert.equal(name, "followUps");
              return {
                where(field: string, operator: string, value: "supplement" | "reminder" | "related") {
                  assert.deepEqual([field, operator], ["type", "=="]);
                  return {
                    get: async () => ({ size: options.counts?.[value] ?? 0 }),
                  };
                },
              };
            },
            async update(patch: Record<string, unknown>) {
              writes.push(patch);
              Object.assign(parent, patch);
            },
          };
        },
      };
    },
  } as unknown as Firestore;
  return { firestore, parent, writes };
}

const related = { type: "related", message: "其他單位補充" };
const supplement = { type: "supplement", message: "原單位補充" };
const reminder = { type: "reminder", message: "提醒" };

test("related create 以實際子集合重算三類 count 與 summary", async () => {
  const store = createStore({ counts: { related: 1 } });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: undefined, after: related }, store.firestore);
  assert.deepEqual(result, { updated: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 }, hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, [{ followUpCounts: { supplement: 0, reminder: 0, related: 1 }, hasRelatedFollowUp: true }]);
  assert.equal(store.parent.title, "公告");
  assert.equal(store.parent.contentUpdatedAt, "2026-09-22T10:00:00Z");
});

test("supplement 與 reminder create 都會建立 idempotent count summary", async () => {
  for (const after of [supplement, reminder]) {
    const store = createStore({ counts: { [after.type]: 1 } });
    const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: undefined, after }, store.firestore);
    assert.equal(result.updated, true);
  }
});

test("原單位 follow-up 以最新 createdAt 同步 lightweight summary，不影響正文更新時間", async () => {
  const createdAt = { toMillis: () => 2000 };
  const store = createStore({ parent: { contentUpdatedAt: "2026-09-22T10:00:00Z", hasRelatedFollowUp: false, followUpCounts: { supplement: 0, reminder: 1, related: 0 }, latestFollowUp: { type: "supplement", createdAt: { toMillis: () => 1000 } } }, counts: { reminder: 1 } });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: undefined, after: { type: "reminder", message: "提醒", createdAt } }, store.firestore);
  assert.deepEqual(result, { updated: true, latestFollowUp: { type: "reminder", createdAt } });
  assert.deepEqual(store.writes, [{ latestFollowUp: { type: "reminder", createdAt } }]);
  assert.equal(store.parent.contentUpdatedAt, "2026-09-22T10:00:00Z");
});

test("related message update 是 no-op", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 1 } });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: related, after: { ...related, message: "更新" } }, store.firestore);
  assert.equal(result.updated, false);
  assert.deepEqual(store.writes, []);
});

test("刪除 related 後仍有其他 related 時維持 true", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 1 } });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: related, after: undefined }, store.firestore);
  assert.deepEqual(result, { updated: false, reason: "already-current", hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, []);
});

test("刪除最後一筆 related 時設為 false", async () => {
  const store = createStore({ parent: { title: "公告", hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 0 } });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: related, after: undefined }, store.firestore);
  assert.deepEqual(result, { updated: true, followUpCounts: { supplement: 0, reminder: 0, related: 0 }, hasRelatedFollowUp: false });
  assert.deepEqual(store.writes, [{ followUpCounts: { supplement: 0, reminder: 0, related: 0 }, hasRelatedFollowUp: false }]);
  assert.equal(store.parent.title, "公告");
});

test("重複 create 事件為冪等，不重複寫入", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 1 } });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: undefined, after: related }, store.firestore);
  assert.deepEqual(result, { updated: false, reason: "already-current", hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, []);
});

test("父公告不存在時安全結束", async () => {
  const store = createStore({ parentExists: false });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "missing", before: undefined, after: related }, store.firestore);
  assert.equal(result.updated, false);
  assert.deepEqual(store.writes, []);
});
