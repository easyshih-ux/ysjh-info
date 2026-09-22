import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("一般 publisher 的發布與編輯頁使用固定單位顯示", () => {
  const publish = source("app/publish/page.tsx");
  const manage = source("app/manage/page.tsx");
  assert.match(publish, /publisher\.role === "systemAdmin" \? <select name="department"/);
  assert.match(publish, /data-publisher-department/);
  assert.match(publish, /依您的發布權限自動設定/);
  assert.match(manage, /publisher\.role === "systemAdmin" \? <label>發布單位<select/);
  assert.match(manage, /依您的發布權限固定，不可修改/);
});

test("發布與編輯都執行 profile department validation", () => {
  const publish = source("app/publish/page.tsx");
  const manage = source("app/manage/page.tsx");
  assert.match(publish, /validatePublisherDepartment\(normalizedDraft\.department, publisher\)/);
  assert.match(publish, /department: publisher\.defaultDepartment/);
  assert.match(manage, /validatePublisherDepartment\(editing\.department, publisher\)/);
});

test("業務聯絡仍維持獨立可選單位", () => {
  const publish = source("app/publish/page.tsx");
  const manage = source("app/manage/page.tsx");
  assert.match(publish, /聯絡單位<select[\s\S]*DepartmentOptionGroups includeOther/);
  assert.match(manage, /聯絡單位<select[\s\S]*DepartmentOptionGroups includeOther/);
});
