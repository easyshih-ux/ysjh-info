import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("老師端提供低調的發布工作台入口", () => {
  assert.match(source("app/page.tsx"), /href="\/admin"[^>]*>公務資訊發布/);
});

test("發布工作台連結發布、管理與老師端入口", () => {
  const page = source("app/admin/page.tsx");
  assert.match(page, /href="\/publish"/);
  assert.match(page, /href="\/manage"/);
  assert.match(page, /href="\/"/);
  assert.match(page, /未設登入或權限驗證/);
});

test("發布與管理頁皆可返回發布工作台", () => {
  assert.match(source("app/publish/page.tsx"), /href="\/admin"[^>]*className=\{styles\.back\}/);
  assert.match(source("app/manage/layout.tsx"), /href="\/admin"/);
});
