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
