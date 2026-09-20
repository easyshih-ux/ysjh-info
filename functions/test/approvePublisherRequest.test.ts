import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { approvePublisherRequestHandler, listPublisherManagementHandler, managePublisherAccessHandler, transferSystemAdminHandler } from "../src/index.ts";
import { DEPARTMENTS } from "../src/departments.ts";

type DocumentData = Record<string, unknown>;

function createStore(initial: Record<string, DocumentData> = {}, failUpdatePath = "") {
  const documents = new Map(
    Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]),
  );

  const firestore = {
    collection(collectionName: string) {
      return {
        doc(id: string) {
          const path = `${collectionName}/${id}`;
          return {
            path,
            async get() {
              const data = documents.get(path);
              return { exists: data !== undefined, data: () => data === undefined ? undefined : structuredClone(data) };
            },
          };
        },
        async get() {
          return { docs: [...documents.entries()].filter(([path]) => path.startsWith(`${collectionName}/`)).map(([path, data]) => ({ id: path.slice(collectionName.length + 1), data: () => structuredClone(data) })) };
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
          if (reference.path === failUpdatePath) throw new Error("simulated transaction failure");
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
  requestedDepartment: "設備組",
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

test("校長是合法 defaultDepartment", async () => {
  const store = createStore({
    "authorizedPublishers/admin": admin(),
    "publisherRequests/target": pending(),
  });

  await approvePublisherRequestHandler(
    request("admin", { defaultDepartment: "校長" }),
    store.firestore,
  );
  assert.equal(store.get("authorizedPublishers/target")?.defaultDepartment, "校長");
});

test("Functions 固定發布單位同步為22個並包含人事室與會計室", () => {
  assert.equal(DEPARTMENTS.length, 22);
  assert.equal(new Set(DEPARTMENTS).size, 22);
  assert.ok(DEPARTMENTS.includes("人事室"));
  assert.ok(DEPARTMENTS.includes("會計室"));
});

test("保留字不能作為實際 defaultDepartment", async () => {
  const store = createStore();
  await rejectsWithCode(
    approvePublisherRequestHandler(request("admin", { defaultDepartment: "其他" }), store.firestore),
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

const managementRequest = (action: string, data: Record<string, unknown> = {}, uid = "admin") => ({
  auth: uid ? { uid } : null,
  data: { targetUid: "target", action, ...data },
});

test("只有 enabled systemAdmin 可以執行發布者管理動作", async () => {
  const store = createStore({
    "authorizedPublishers/admin": { role: "publisher", enabled: true },
    "authorizedPublishers/target": { role: "publisher", enabled: true },
  });
  await rejectsWithCode(managePublisherAccessHandler(managementRequest("disable"), store.firestore), "permission-denied");
});

test("systemAdmin 可以拒絕 pending 申請", async () => {
  const store = createStore({ "authorizedPublishers/admin": admin(), "publisherRequests/target": pending() });
  await managePublisherAccessHandler(managementRequest("reject"), store.firestore);
  assert.equal(store.get("publisherRequests/target")?.status, "rejected");
});

test("停用與重新啟用維持既有角色及帳號資料", async () => {
  const profile = { role: "publisher", enabled: true, email: "changed@example.test", displayName: "Changed", defaultDepartment: "設備組" };
  const store = createStore({ "authorizedPublishers/admin": admin(), "authorizedPublishers/target": profile });
  await managePublisherAccessHandler(managementRequest("disable"), store.firestore);
  assert.equal(store.get("authorizedPublishers/target")?.enabled, false);
  await managePublisherAccessHandler(managementRequest("enable"), store.firestore);
  const updated = store.get("authorizedPublishers/target");
  assert.equal(updated?.enabled, true);
  assert.equal(updated?.role, "publisher");
  assert.equal(updated?.email, "changed@example.test");
  assert.equal(updated?.displayName, "Changed");
});

test("更換發布單位接受22個固定單位與有效自訂名稱", async () => {
  const store = createStore({ "authorizedPublishers/admin": admin(), "authorizedPublishers/target": { role: "publisher", enabled: true, defaultDepartment: "設備組" } });
  await managePublisherAccessHandler(managementRequest("changeDepartment", { defaultDepartment: "校長" }), store.firestore);
  assert.equal(store.get("authorizedPublishers/target")?.defaultDepartment, "校長");
  await managePublisherAccessHandler(managementRequest("changeDepartment", { defaultDepartment: " 家長會 " }), store.firestore).then(() => assert.fail("未 trim 的自訂名稱不應通過"), error => assert.equal(error.code, "invalid-argument"));
  await managePublisherAccessHandler(managementRequest("changeDepartment", { defaultDepartment: "家長會" }), store.firestore);
  assert.equal(store.get("authorizedPublishers/target")?.defaultDepartment, "家長會");
});

test("只有申請其他時可核准自訂單位，且空白、保留字與過長名稱被拒絕", async () => {
  for (const value of [" ", "其他", "甲".repeat(31)]) {
    await rejectsWithCode(approvePublisherRequestHandler(request("admin", { defaultDepartment: value }), createStore().firestore), "invalid-argument");
  }
  const fixedRequest = createStore({ "authorizedPublishers/admin": admin(), "publisherRequests/target": pending() });
  await rejectsWithCode(approvePublisherRequestHandler(request("admin", { defaultDepartment: "家長會" }), fixedRequest.firestore), "failed-precondition");
  const otherRequest = createStore({ "authorizedPublishers/admin": admin(), "publisherRequests/target": { ...pending(), requestedDepartment: "其他" } });
  await approvePublisherRequestHandler(request("admin", { defaultDepartment: "家長會" }), otherRequest.firestore);
  assert.equal(otherRequest.get("authorizedPublishers/target")?.defaultDepartment, "家長會");
});

test("發布者管理不能變更 systemAdmin", async () => {
  const original = { role: "systemAdmin", enabled: true, defaultDepartment: "設備組" };
  const store = createStore({ "authorizedPublishers/admin": admin(), "authorizedPublishers/target": original });
  await rejectsWithCode(managePublisherAccessHandler(managementRequest("disable"), store.firestore), "failed-precondition");
  assert.deepEqual(store.get("authorizedPublishers/target"), original);
});

test("只有 enabled systemAdmin 可以取得待審與既有發布者清單", async () => {
  const store = createStore({
    "authorizedPublishers/admin": admin(),
    "authorizedPublishers/target": { role: "publisher", enabled: true, email: "changed@example.test", displayName: "Changed", defaultDepartment: "設備組" },
    "publisherRequests/pending-user": pending(),
  });
  const result = await listPublisherManagementHandler({ auth: { uid: "admin" } }, store.firestore);
  assert.equal(result.publishers.some(item => item.uid === "target" && item.email === "changed@example.test"), true);
  assert.equal(result.requests.some(item => item.uid === "pending-user"), true);
  await rejectsWithCode(listPublisherManagementHandler({ auth: { uid: "target" } }, store.firestore), "permission-denied");
});

const transferRequest = (uid = "admin", targetUid = "target") => ({ auth: uid ? { uid } : null, data: { targetUid } });
const fullProfile = (role: "publisher" | "systemAdmin", enabled = true) => ({
  role,
  enabled,
  email: `${role}@example.test`,
  displayName: role === "systemAdmin" ? "Current Admin" : "Next Admin",
  defaultDepartment: role === "systemAdmin" ? "設備組" : "家長會",
  createdAt: "created-at",
  createdBy: "bootstrap",
});

test("enabled systemAdmin 可原子移交給 enabled publisher 並保留雙方資料", async () => {
  const current = fullProfile("systemAdmin");
  const target = fullProfile("publisher");
  const store = createStore({ "authorizedPublishers/admin": current, "authorizedPublishers/target": target });

  assert.deepEqual(await transferSystemAdminHandler(transferRequest(), store.firestore), {
    success: true,
    previousSystemAdminUid: "admin",
    systemAdminUid: "target",
  });
  const updatedCurrent = store.get("authorizedPublishers/admin");
  const updatedTarget = store.get("authorizedPublishers/target");
  assert.equal(updatedCurrent?.role, "publisher");
  assert.equal(updatedCurrent?.enabled, true);
  assert.equal(updatedTarget?.role, "systemAdmin");
  assert.equal(updatedTarget?.enabled, true);
  for (const key of ["email", "displayName", "defaultDepartment", "createdAt", "createdBy"]) {
    assert.equal(updatedCurrent?.[key], current[key as keyof typeof current]);
    assert.equal(updatedTarget?.[key], target[key as keyof typeof target]);
  }
});

test("一般 publisher 與 disabled systemAdmin 都不能移交最高管理權", async () => {
  for (const caller of [fullProfile("publisher"), fullProfile("systemAdmin", false)]) {
    const store = createStore({ "authorizedPublishers/admin": caller, "authorizedPublishers/target": fullProfile("publisher") });
    await rejectsWithCode(transferSystemAdminHandler(transferRequest(), store.firestore), "permission-denied");
    assert.equal(store.get("authorizedPublishers/admin")?.role, caller.role);
    assert.equal(store.get("authorizedPublishers/target")?.role, "publisher");
  }
});

test("不存在、disabled 或非 publisher 的 target 無法接任", async () => {
  const cases: Array<[DocumentData | undefined, string]> = [
    [undefined, "not-found"],
    [fullProfile("publisher", false), "failed-precondition"],
    [fullProfile("systemAdmin"), "failed-precondition"],
  ];
  for (const [target, code] of cases) {
    const initial: Record<string, DocumentData> = { "authorizedPublishers/admin": fullProfile("systemAdmin") };
    if (target) initial["authorizedPublishers/target"] = target;
    const store = createStore(initial);
    await rejectsWithCode(transferSystemAdminHandler(transferRequest(), store.firestore), code);
    assert.equal(store.get("authorizedPublishers/admin")?.role, "systemAdmin");
  }
});

test("profile schema 不完整的無效帳號不得接任", async () => {
  const invalidTarget = { ...fullProfile("publisher"), email: "", defaultDepartment: "" };
  const store = createStore({ "authorizedPublishers/admin": fullProfile("systemAdmin"), "authorizedPublishers/target": invalidTarget });
  await rejectsWithCode(transferSystemAdminHandler(transferRequest(), store.firestore), "failed-precondition");
  assert.equal(store.get("authorizedPublishers/admin")?.role, "systemAdmin");
  assert.equal(store.get("authorizedPublishers/target")?.role, "publisher");
});

test("systemAdmin 不可移交給自己", async () => {
  const store = createStore({ "authorizedPublishers/admin": fullProfile("systemAdmin") });
  await rejectsWithCode(transferSystemAdminHandler(transferRequest("admin", "admin"), store.firestore), "invalid-argument");
  assert.equal(store.get("authorizedPublishers/admin")?.role, "systemAdmin");
});

test("transaction 任一步失敗時雙方角色均不變且不會產生零位 systemAdmin", async () => {
  const store = createStore({
    "authorizedPublishers/admin": fullProfile("systemAdmin"),
    "authorizedPublishers/target": fullProfile("publisher"),
  }, "authorizedPublishers/admin");
  await assert.rejects(transferSystemAdminHandler(transferRequest(), store.firestore), /simulated transaction failure/);
  assert.equal(store.get("authorizedPublishers/admin")?.role, "systemAdmin");
  assert.equal(store.get("authorizedPublishers/target")?.role, "publisher");
});
