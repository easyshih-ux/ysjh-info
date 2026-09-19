import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePublisherAccess } from "../lib/publisherAccess.ts";
import { parsePublisherProfileDocument } from "../lib/publisherProfile.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const timestamp = {
  seconds: 1,
  nanoseconds: 0,
  toDate: () => new Date(1000),
};

const completeProfile = (role: "publisher" | "systemAdmin") => ({
  email: "publisher@ysjh.ntpc.edu.tw",
  displayName: "測試發布者",
  role,
  enabled: true,
  defaultDepartment: "設備組",
  createdAt: timestamp,
  createdBy: "bootstrap-admin",
  updatedAt: timestamp,
  updatedBy: "bootstrap-admin",
});

test("Firebase 尚未確認與未登入仍由共用 Guard 處理", () => {
  const guard = source("components/admin-auth-guard.tsx");
  assert.match(guard, /status === "checking"/);
  assert.match(guard, /status === "signed-out" \|\| !user/);
  assert.match(guard, /usePublisherProfile\(user\?\.uid\)/);
});

test("完整 enabled publisher profile 取得 publisher 權限", () => {
  const result = parsePublisherProfileDocument(completeProfile("publisher"));
  assert.equal(result.status, "valid");
  assert.equal(resolvePublisherAccess(result, "publisher@ysjh.ntpc.edu.tw").status, "publisher");
});

test("完整 enabled systemAdmin profile 取得 systemAdmin 權限", () => {
  const result = parsePublisherProfileDocument(completeProfile("systemAdmin"));
  assert.equal(result.status, "valid");
  assert.equal(resolvePublisherAccess(result, "publisher@ysjh.ntpc.edu.tw").status, "systemAdmin");
});

test("enabled false 永遠是 disabled", () => {
  const result = parsePublisherProfileDocument({
    ...completeProfile("publisher"),
    email: "easyshih@ysjh.ntpc.edu.tw",
    enabled: false,
  });
  assert.deepEqual(resolvePublisherAccess(result, "easyshih@ysjh.ntpc.edu.tw"), { status: "disabled" });
});

test("非法 role 不得利用 legacy allowlist 通過", () => {
  const result = parsePublisherProfileDocument({
    ...completeProfile("publisher"),
    email: "easyshih@ysjh.ntpc.edu.tw",
    role: "owner",
  });
  assert.deepEqual(result, { status: "invalid", reason: "invalid-role" });
  assert.deepEqual(resolvePublisherAccess(result, "easyshih@ysjh.ntpc.edu.tw"), {
    status: "unauthorized",
    reason: "invalid-profile",
  });
});

test("profile 不存在時不以 legacy allowlist 放行", () => {
  assert.deepEqual(resolvePublisherAccess(
    { status: "not-found" },
    "easyshih@ysjh.ntpc.edu.tw",
  ), { status: "unauthorized", reason: "not-found" });
});

test("Firestore read error 回傳一般狀態且不暴露 raw error", () => {
  assert.deepEqual(resolvePublisherAccess(
    { status: "error" },
    "easyshih@ysjh.ntpc.edu.tw",
  ), { status: "unauthorized", reason: "read-error" });
  assert.doesNotMatch(source("lib/publisherProfile.ts"), /error\.message|FirebaseError/);
});

test("舊格式 enabled profile 只有同 email legacy allowlist 可暫時通過", () => {
  const result = parsePublisherProfileDocument({
    email: "easyshih@ysjh.ntpc.edu.tw",
    defaultDepartment: "設備組",
    enabled: true,
  });
  const authorization = resolvePublisherAccess(result, " EASYSHIH@YSJH.NTPC.EDU.TW ");
  assert.equal(authorization.status, "legacy");
  if (authorization.status === "legacy") {
    assert.equal(authorization.publisher.role, null);
    assert.equal(authorization.publisher.defaultDepartment, "設備組");
  }
});

test("舊格式 profile 的 email 不在 legacy allowlist 時不得通過", () => {
  const result = parsePublisherProfileDocument({
    email: "unknown@ysjh.ntpc.edu.tw",
    defaultDepartment: "設備組",
    enabled: true,
  });
  assert.deepEqual(resolvePublisherAccess(result, "unknown@ysjh.ntpc.edu.tw"), {
    status: "unauthorized",
    reason: "legacy-not-allowed",
  });
});

test("舊格式 profile email 與登入 email 不一致時不得通過", () => {
  const result = parsePublisherProfileDocument({
    email: "easyshih@ysjh.ntpc.edu.tw",
    defaultDepartment: "設備組",
    enabled: true,
  });
  assert.deepEqual(resolvePublisherAccess(result, "other@ysjh.ntpc.edu.tw"), {
    status: "unauthorized",
    reason: "legacy-not-allowed",
  });
});

test("profile schema 缺少稽核欄位且已有 role 時視為不完整而非 legacy", () => {
  const result = parsePublisherProfileDocument({
    email: "easyshih@ysjh.ntpc.edu.tw",
    defaultDepartment: "設備組",
    enabled: true,
    role: "systemAdmin",
  });
  assert.deepEqual(result, { status: "invalid", reason: "incomplete-schema" });
});

test("三個行政路由仍只共用 AdminAuthGuard", () => {
  assert.match(source("app/admin/page.tsx"), /<AdminAuthGuard>/);
  assert.match(source("app/publish/page.tsx"), /<AdminAuthGuard>/);
  assert.match(source("app/manage/layout.tsx"), /<AdminAuthGuard>/);
  assert.doesNotMatch(source("app/admin/page.tsx"), /resolvePublisherAccess|usePublisherProfile/);
  assert.doesNotMatch(source("app/publish/page.tsx"), /resolvePublisherAccess|usePublisherProfile/);
  assert.doesNotMatch(source("app/manage/layout.tsx"), /resolvePublisherAccess|usePublisherProfile/);
});
