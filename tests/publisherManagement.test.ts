import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePendingPublisherRequest } from "../lib/publisherRequestManagement.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const timestamp = {
  seconds: 1,
  nanoseconds: 0,
  toDate: () => new Date(1000),
  toMillis: () => 1000,
};

test("systemAdmin 才會在行政工作台看到發布者管理入口", () => {
  const page = source("app/admin/page.tsx");
  assert.match(page, /publisher\.role === "systemAdmin"/);
  assert.match(page, /href="\/admin\/publishers"/);
  assert.match(page, /發布者管理/);
});

test("發布者管理頁共用 AdminAuthGuard 並再次限制 systemAdmin", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /<AdminAuthGuard>/);
  assert.match(page, /publisher\.role === "systemAdmin"/);
  assert.match(page, /此功能僅供系統管理員使用。/);
});

test("只讀頁顯示 pending 數量、空狀態與友善錯誤", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /待核准發布者/);
  assert.match(page, /state\.requests\.length/);
  assert.match(page, /目前沒有待核准的發布權限申請。/);
  assert.match(page, /目前無法讀取發布權限申請，請稍後再試。/);
  assert.doesNotMatch(page, /error\.message|FirebaseError/);
});

test("待核准申請 parser 保留顯示欄位並排除非 pending", () => {
  assert.deepEqual(parsePendingPublisherRequest("user-a", {
    email: " user-a@example.test ",
    displayName: "User A",
    requestedAt: timestamp,
    status: "pending",
  }), {
    uid: "user-a",
    email: "user-a@example.test",
    displayName: "User A",
    requestedAt: timestamp,
    status: "pending",
  });
  assert.equal(parsePendingPublisherRequest("user-b", {
    email: "user-b@example.test",
    displayName: "User B",
    requestedAt: timestamp,
    status: "rejected",
  }), null);
});

test("發布者管理資料層只有 list，沒有 request 或 publisher 寫入", () => {
  const repository = source("lib/publisherRequestManagement.ts");
  assert.match(repository, /getDocs/);
  assert.doesNotMatch(repository, /setDoc|updateDoc|deleteDoc/);
});

test("pending 申請使用既有發布單位並提供防重複核准狀態", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /import \{ DEPARTMENTS, type Department \} from "@\/lib\/departments"/);
  assert.match(page, /DEPARTMENTS\.map/);
  assert.match(page, /核准發布權限/);
  assert.match(page, /核准處理中…/);
  assert.match(page, /disabled=\{approvingUid !== null\}/);
});

test("Callable 固定 asia-east1 且 payload 只有 targetUid 與 defaultDepartment", () => {
  const repository = source("lib/publisherRequestManagement.ts");
  const callable = repository.match(/export async function approvePublisherRequest[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(repository, /getFunctions\(getFirebaseApp\(\), "asia-east1"\)/);
  assert.match(repository, /functions, "approvePublisherRequest"/);
  assert.match(repository, /await approve\(\{ targetUid, defaultDepartment \}\)/);
  assert.doesNotMatch(callable, /email|displayName|role|enabled/);
});

test("核准成功後刷新 pending 清單，失敗顯示友善訊息並保留 console error", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /await state\.refresh\(\)/);
  assert.match(page, /發布權限已核准。/);
  assert.match(page, /目前無法核准發布權限，請稍後再試。/);
  assert.match(page, /console\.error\("approvePublisherRequest failed", error\)/);
});
