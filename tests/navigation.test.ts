import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("老師端提供低調的發布工作台入口", () => {
  const page = source("app/page.tsx");
  assert.match(page, /className="admin-entry" href="\/admin"/);
  assert.match(page, /<Settings[^>]*\/>行政管理/);
  assert.match(page, /<small>Made by WenYi<\/small>/);
});

test("發布工作台由共用 Auth Guard 保護並保留三個入口", () => {
  const page = source("app/admin/page.tsx");
  assert.match(page, /href="\/publish"/);
  assert.match(page, /href="\/manage"/);
  assert.match(page, /href="\/"/);
  assert.match(page, /查看義學公務資訊站/);
  assert.match(page, /<AdminAuthGuard>/);
});

test("發布與管理頁皆受保護並可返回發布工作台", () => {
  const publishPage = source("app/publish/page.tsx");
  const manageLayout = source("app/manage/layout.tsx");
  assert.match(publishPage, /<AdminAuthGuard>/);
  assert.match(publishPage, /href="\/admin"[^>]*className=\{styles\.back\}/);
  assert.match(publishPage, /返回行政管理/);
  assert.match(manageLayout, /<AdminAuthGuard>/);
  assert.match(manageLayout, /href="\/admin"[^>]*>[\s\S]*返回行政管理/);
});

test("共用行政 Auth Guard 顯示 Firebase 使用者 email 並使用共用 logout", () => {
  const guard = source("components/admin-auth-guard.tsx");
  assert.match(guard, /<span>\{user\.email\}<\/span>/);
  assert.match(guard, /onClick=\{logout\}/);
  assert.match(guard, /正在登出…/);
});
