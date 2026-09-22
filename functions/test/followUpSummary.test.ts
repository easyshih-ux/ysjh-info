import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { syncRelatedFollowUpSummaryChange } from "../src/followUpSummary.ts";

function createStore(options: { parent?: Record<string, unknown>; parentExists?: boolean; remainingRelated?: number } = {}) {
  const parent = structuredClone(options.parent ?? { title: "公告", contentUpdatedAt: "2026-09-22T10:00:00Z" });
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
                where(field: string, operator: string, value: string) {
                  assert.deepEqual([field, operator, value], ["type", "==", "related"]);
                  return {
                    limit(value: number) {
                      assert.equal(value, 1);
                      return { get: async () => ({ empty: (options.remainingRelated ?? 0) === 0 }) };
                    },
                  };
                },
              };
            },
            async update(patch: Record<string, unknown>) {
              writes.push(structuredClone(patch));
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

test("related create 將父公告 summary 設為 true，且只更新該欄位", async () => {
  const store = createStore();
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: undefined, after: related }, store.firestore);
  assert.deepEqual(result, { updated: true, hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, [{ hasRelatedFollowUp: true }]);
  assert.equal(store.parent.title, "公告");
  assert.equal(store.parent.contentUpdatedAt, "2026-09-22T10:00:00Z");
});

test("supplement 與 reminder create 都是 no-op", async () => {
  for (const after of [supplement, reminder]) {
    const store = createStore();
    const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: undefined, after }, store.firestore);
    assert.equal(result.updated, false);
    assert.deepEqual(store.writes, []);
  }
});

test("related message update 是 no-op", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true } });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: related, after: { ...related, message: "更新" } }, store.firestore);
  assert.equal(result.updated, false);
  assert.deepEqual(store.writes, []);
});

test("刪除 related 後仍有其他 related 時維持 true", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true }, remainingRelated: 1 });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: related, after: undefined }, store.firestore);
  assert.deepEqual(result, { updated: false, reason: "already-current", hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, []);
});

test("刪除最後一筆 related 時設為 false", async () => {
  const store = createStore({ parent: { title: "公告", hasRelatedFollowUp: true }, remainingRelated: 0 });
  const result = await syncRelatedFollowUpSummaryChange({ announcementId: "a", before: related, after: undefined }, store.firestore);
  assert.deepEqual(result, { updated: true, hasRelatedFollowUp: false });
  assert.deepEqual(store.writes, [{ hasRelatedFollowUp: false }]);
  assert.equal(store.parent.title, "公告");
});

test("重複 create 事件為冪等，不重複寫入", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true } });
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
