import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { approvePublisherRequestHandler } from "../src/index.ts";

type DocumentData = Record<string, unknown>;

function createStore(initial: Record<string, DocumentData> = {}) {
  const documents = new Map(
    Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]),
  );

  const firestore = {
    collection(collectionName: string) {
      return {
        doc(id: string) {
          return { path: `${collectionName}/${id}` };
        },
      };
    },
    async runTransaction<T>(operation: (transaction: unknown) => Promise<T>) {
      const writes: Array<() => void> = [];
      const transaction = {
        async get(reference: { path: string }) {
          const data = documents.get(reference.path);
          return {
            exists: data !== undefined,
            data: () => data === undefined ? undefined : structuredClone(data),
          };
        },
        set(reference: { path: string }, data: DocumentData) {
          writes.push(() => documents.set(reference.path, structuredClone(data)));
        },
        update(reference: { path: string }, patch: DocumentData) {
          writes.push(() => {
            const current = documents.get(reference.path);
            if (!current) throw new Error(`Missing document: ${reference.path}`);
            documents.set(reference.path, { ...current, ...structuredClone(patch) });
          });
        },
      };

      const result = await operation(transaction);
      writes.forEach(write => write());
      return result;
    },
  } as unknown as Firestore;

  return {
    firestore,
    get(path: string) {
      const data = documents.get(path);
      return data === undefined ? undefined : structuredClone(data);
    },
  };
}

const request = (uid = "admin", data: Record<string, unknown> = {}) => ({
  auth: uid ? { uid } : null,
  data: { targetUid: "target", defaultDepartment: "設備組", ...data },
});

const admin = (enabled = true) => ({ role: "systemAdmin", enabled });
const pending = () => ({
  email: "target@example.test",
  displayName: "Target User",
  requestedAt: "original-requested-at",
  lastSeenAt: "original-last-seen-at",
  status: "pending",
});

async function rejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, error => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

test("未登入不能核准", async () => {
  const store = createStore();
  await rejectsWithCode(
    approvePublisherRequestHandler(request(""), store.firestore),
    "unauthenticated",
  );
});

test("一般 publisher 不能核准", async () => {
  const store = createStore({
    "authorizedPublishers/admin": { role: "publisher", enabled: true },
    "publisherRequests/target": pending(),
  });
  await rejectsWithCode(
    approvePublisherRequestHandler(request(), store.firestore),
    "permission-denied",
  );
});

test("disabled systemAdmin 不能核准", async () => {
  const store = createStore({
    "authorizedPublishers/admin": admin(false),
    "publisherRequests/target": pending(),
  });
  await rejectsWithCode(
    approvePublisherRequestHandler(request(), store.firestore),
    "permission-denied",
  );
});

test("enabled systemAdmin 可以核准 pending request 並寫入正確資料", async () => {
  const store = createStore({
    "authorizedPublishers/admin": admin(),
    "publisherRequests/target": pending(),
  });

  assert.deepEqual(
    await approvePublisherRequestHandler(request(), store.firestore),
    { approved: true, targetUid: "target" },
  );
  const profile = store.get("authorizedPublishers/target");
  assert.equal(profile?.role, "publisher");
  assert.equal(profile?.enabled, true);
  assert.equal(profile?.defaultDepartment, "設備組");
  assert.equal(profile?.email, "target@example.test");
  assert.equal(profile?.displayName, "Target User");
  assert.equal(store.get("publisherRequests/target")?.status, "approved");
});

test("非法 defaultDepartment 被拒絕", async () => {
  const store = createStore();
  await rejectsWithCode(
    approvePublisherRequestHandler(request("admin", { defaultDepartment: "不存在單位" }), store.firestore),
    "invalid-argument",
  );
});

test("request 不存在被拒絕", async () => {
  const store = createStore({ "authorizedPublishers/admin": admin() });
  await rejectsWithCode(
    approvePublisherRequestHandler(request(), store.firestore),
    "not-found",
  );
});

test("request 非 pending 被拒絕", async () => {
  const store = createStore({
    "authorizedPublishers/admin": admin(),
    "publisherRequests/target": { ...pending(), status: "approved" },
  });
  await rejectsWithCode(
    approvePublisherRequestHandler(request(), store.firestore),
    "failed-precondition",
  );
});

test("target 已是 systemAdmin 時拒絕且 transaction 不修改任何資料", async () => {
  const existingProfile = {
    role: "systemAdmin",
    enabled: false,
    createdAt: "existing-created-at",
    createdBy: "bootstrap-admin",
  };
  const existingRequest = pending();
  const store = createStore({
    "authorizedPublishers/admin": admin(),
    "authorizedPublishers/target": existingProfile,
    "publisherRequests/target": existingRequest,
  });

  await rejectsWithCode(
    approvePublisherRequestHandler(request(), store.firestore),
    "failed-precondition",
  );
  assert.deepEqual(store.get("authorizedPublishers/target"), existingProfile);
  assert.deepEqual(store.get("publisherRequests/target"), existingRequest);
});

test("既有 target profile 保留 createdAt 與 createdBy", async () => {
  const store = createStore({
    "authorizedPublishers/admin": admin(),
    "authorizedPublishers/target": {
      role: "publisher",
      enabled: false,
      createdAt: "existing-created-at",
      createdBy: "original-admin",
    },
    "publisherRequests/target": pending(),
  });

  await approvePublisherRequestHandler(request(), store.firestore);
  const profile = store.get("authorizedPublishers/target");
  assert.equal(profile?.createdAt, "existing-created-at");
  assert.equal(profile?.createdBy, "original-admin");
});
