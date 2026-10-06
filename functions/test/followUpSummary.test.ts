import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { syncFollowUpSummaryChange } from "../src/followUpSummary.ts";

type FollowUpType = "supplement" | "reminder" | "related";
type FollowUpRows = Partial<Record<FollowUpType, Record<string, unknown>[]>>;

function createStore(options: { parent?: Record<string, unknown>; parentExists?: boolean; counts?: Partial<Record<FollowUpType, number>>; followUps?: FollowUpRows } = {}) {
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
                where(field: string, operator: string, value: FollowUpType) {
                  assert.deepEqual([field, operator], ["type", "=="]);
                  return {
                    get: async () => {
                      const rows = options.followUps?.[value];
                      return rows
                        ? { size: rows.length, docs: rows.map(data => ({ data: () => data })) }
                        : { size: options.counts?.[value] ?? 0 };
                    },
                  };
                },
              };
            },
            async update(patch: Record<string, unknown>) {
              writes.push(patch);
              Object.assign(parent, patch);
              if ("latestFollowUp" in patch && !(patch.latestFollowUp as Record<string, unknown> | undefined)?.type) delete parent.latestFollowUp;
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
const timestamp = (millis: number) => ({ toMillis: () => millis });

test("related create 以實際子集合重算三類 count 與 summary", async () => {
  const store = createStore({ counts: { related: 1 } });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: undefined, after: related }, store.firestore);
  assert.deepEqual(result, { updated: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 }, hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, [{ followUpCounts: { supplement: 0, reminder: 0, related: 1 }, hasRelatedFollowUp: true }]);
  assert.equal(store.parent.title, "公告");
  assert.equal(store.parent.contentUpdatedAt, "2026-09-22T10:00:00Z");
});

test("supplement 與 reminder create 都會建立 idempotent count summary", async () => {
  for (const after of [supplement, reminder]) {
    const store = createStore({ counts: { [after.type]: 1 } });
    const result = await syncFollowUpSummaryChange({ announcementId: "a", before: undefined, after }, store.firestore);
    assert.equal(result.updated, true);
  }
});

test("原單位 follow-up 以最新 createdAt 同步 lightweight summary，不影響正文更新時間", async () => {
  const createdAt = { toMillis: () => 2000 };
  const store = createStore({ parent: { contentUpdatedAt: "2026-09-22T10:00:00Z", hasRelatedFollowUp: false, followUpCounts: { supplement: 0, reminder: 1, related: 0 }, latestFollowUp: { type: "supplement", createdAt: { toMillis: () => 1000 } } }, counts: { reminder: 1 } });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: undefined, after: { type: "reminder", message: "提醒", createdAt } }, store.firestore);
  assert.deepEqual(result, { updated: true, latestFollowUp: { type: "reminder", createdAt } });
  assert.deepEqual(store.writes, [{ latestFollowUp: { type: "reminder", createdAt } }]);
  assert.equal(store.parent.contentUpdatedAt, "2026-09-22T10:00:00Z");
});

test("related message update 是 no-op", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 1 } });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: related, after: { ...related, message: "更新" } }, store.firestore);
  assert.equal(result.updated, false);
  assert.deepEqual(store.writes, []);
});

test("刪除 related 後仍有其他 related 時維持 true", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 1 } });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: related, after: undefined }, store.firestore);
  assert.deepEqual(result, { updated: false, reason: "already-current", hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, []);
});

test("刪除最後一筆 related 時設為 false", async () => {
  const store = createStore({ parent: { title: "公告", hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 0 } });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: related, after: undefined }, store.firestore);
  assert.deepEqual(result, { updated: true, followUpCounts: { supplement: 0, reminder: 0, related: 0 }, hasRelatedFollowUp: false });
  assert.deepEqual(store.writes, [{ followUpCounts: { supplement: 0, reminder: 0, related: 0 }, hasRelatedFollowUp: false }]);
  assert.equal(store.parent.title, "公告");
});

test("重複 create 事件為冪等，不重複寫入", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 1 } });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: undefined, after: related }, store.firestore);
  assert.deepEqual(result, { updated: false, reason: "already-current", hasRelatedFollowUp: true });
  assert.deepEqual(store.writes, []);
});

test("亂序 related 事件仍依實際子集合重算並收斂", async () => {
  const store = createStore({ parent: { hasRelatedFollowUp: true, followUpCounts: { supplement: 0, reminder: 0, related: 1 } }, counts: { related: 2 } });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: related, after: undefined }, store.firestore);
  assert.deepEqual(result, { updated: true, followUpCounts: { supplement: 0, reminder: 0, related: 2 } });
  assert.deepEqual(store.writes, [{ followUpCounts: { supplement: 0, reminder: 0, related: 2 } }]);
});

test("父公告不存在時安全結束", async () => {
  const store = createStore({ parentExists: false });
  const result = await syncFollowUpSummaryChange({ announcementId: "missing", before: undefined, after: related }, store.firestore);
  assert.equal(result.updated, false);
  assert.deepEqual(store.writes, []);
});

test("withdrawn supplement 與 reminder 不計入 count 或 latest，無 status child 維持 active", async () => {
  const activeSupplementAt = timestamp(200);
  const store = createStore({
    parent: {
      followUpCounts: { supplement: 2, reminder: 1, related: 0 },
      latestFollowUp: { type: "reminder", createdAt: timestamp(900) },
    },
    followUps: {
      supplement: [
        { type: "supplement", status: "withdrawn", createdAt: timestamp(300) },
        { type: "supplement", createdAt: activeSupplementAt },
      ],
      reminder: [{ type: "reminder", status: "withdrawn", createdAt: timestamp(400) }],
    },
  });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: { type: "reminder", status: "active" }, after: { type: "reminder", status: "withdrawn" } }, store.firestore);
  assert.deepEqual(result, {
    updated: true,
    followUpCounts: { supplement: 1, reminder: 0, related: 0 },
    hasRelatedFollowUp: false,
    latestFollowUp: { type: "supplement", createdAt: activeSupplementAt },
  });
});

test("withdrawn related 不影響 related count，legacy followUps 仍納入 summary", async () => {
  const legacyCreatedAt = timestamp(700);
  const store = createStore({
    parent: {
      followUps: [
        { type: "supplement", createdAt: legacyCreatedAt },
        { type: "related", createdAt: timestamp(600) },
      ],
    },
    followUps: {
      supplement: [{ type: "supplement", status: "withdrawn", createdAt: timestamp(900) }],
      related: [{ type: "related", status: "withdrawn", createdAt: timestamp(800) }],
    },
  });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: undefined, after: { type: "supplement", status: "withdrawn", createdAt: timestamp(900) } }, store.firestore);
  assert.deepEqual(result, {
    updated: true,
    followUpCounts: { supplement: 1, reminder: 0, related: 2 },
    hasRelatedFollowUp: true,
    latestFollowUp: { type: "supplement", createdAt: legacyCreatedAt },
  });
});

test("撤回最後一筆 original follow-up 時移除 latest summary", async () => {
  const createdAt = timestamp(500);
  const store = createStore({
    parent: {
      followUpCounts: { supplement: 1, reminder: 0, related: 0 },
      hasRelatedFollowUp: false,
      latestFollowUp: { type: "supplement", createdAt },
    },
    followUps: { supplement: [{ type: "supplement", status: "withdrawn", createdAt }] },
  });
  const result = await syncFollowUpSummaryChange({ announcementId: "a", before: { type: "supplement", status: "active", createdAt }, after: { type: "supplement", status: "withdrawn", createdAt } }, store.firestore);
  assert.equal(result.updated, true);
  assert.deepEqual((result as { followUpCounts: unknown }).followUpCounts, { supplement: 0, reminder: 0, related: 0 });
  assert.ok("latestFollowUp" in result);
  assert.equal(store.writes.length, 1);
  assert.ok("latestFollowUp" in store.writes[0]);
});

test("withdraw retry 與亂序事件皆由實際 active 子集合收斂", async () => {
  const createdAt = timestamp(1000);
  const store = createStore({
    parent: { followUpCounts: { supplement: 1, reminder: 0, related: 0 }, hasRelatedFollowUp: false, latestFollowUp: { type: "supplement", createdAt } },
    followUps: { supplement: [{ type: "supplement", status: "withdrawn", createdAt }] },
  });
  const change = { announcementId: "a", before: { type: "supplement", status: "active", createdAt }, after: { type: "supplement", status: "withdrawn", createdAt } };
  await syncFollowUpSummaryChange(change, store.firestore);
  const retry = await syncFollowUpSummaryChange(change, store.firestore);
  assert.equal(retry.updated, false);
  assert.equal(store.writes.length, 1);
});
