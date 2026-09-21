import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEPARTMENTS, OTHER_DEPARTMENT_OPTION, departmentGroups, standaloneDepartments } from "../lib/departments.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("發布單位 optgroup 共用既有 22 個固定單位與其他選項", () => {
  const component = source("components/department-option-groups.tsx");

  assert.equal(DEPARTMENTS.length, 22);
  assert.deepEqual(standaloneDepartments, ["校長", "人事室", "會計室"]);
  assert.deepEqual(departmentGroups.map(group => group.office), ["教務處", "學務處", "總務處", "輔導處"]);
  assert.equal(OTHER_DEPARTMENT_OPTION, "其他");
  assert.match(component, /<optgroup label="校級／獨立單位">/);
  assert.match(component, /departmentGroups\.map\(group => <optgroup key=\{group\.office\} label=\{group\.office\}>/);
  assert.match(component, /<optgroup label="其他">/);
  assert.match(component, /value=\{department\}>\{department\}/);
  assert.match(component, /value=\{OTHER_DEPARTMENT_OPTION\}>\{OTHER_DEPARTMENT_OPTION\}/);
});

test("所有發布單位選擇位置共用相同 optgroup 元件", () => {
  for (const path of [
    "components/admin-auth-guard.tsx",
    "app/admin/publishers/page.tsx",
    "app/publish/page.tsx",
    "app/manage/page.tsx",
    "app/page.tsx",
  ]) {
    assert.match(source(path), /DepartmentOptionGroups/, `${path} 應共用發布單位分組`);
  }
});

test("管理者的其他選項仍保留實際單位輸入流程", () => {
  const page = source("app/admin/publishers/page.tsx");

  assert.match(page, /<DepartmentOptionGroups includeOther \/>/);
  assert.match(page, /實際發布單位名稱/);
  assert.match(page, /customDepartment/);
});
