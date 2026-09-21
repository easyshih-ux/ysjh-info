import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { departmentVisualFamily } from "../lib/departmentVisual.ts";

test("發布單位依處室家族取得固定視覺分類", () => {
  for (const department of ["教務處", "教學組", "註冊組", "資訊組", "設備組"]) assert.equal(departmentVisualFamily(department), "academic");
  for (const department of ["學務處", "生教組", "訓育組", "衛生組", "體育組", "健康中心"]) assert.equal(departmentVisualFamily(department), "student");
  for (const department of ["總務處", "出納組", "文書組", "事務組"]) assert.equal(departmentVisualFamily(department), "general");
  for (const department of ["輔導處", "輔導組", "特教組", "生涯組"]) assert.equal(departmentVisualFamily(department), "counseling");
  assert.equal(departmentVisualFamily("人事室"), "personnel");
  assert.equal(departmentVisualFamily("會計室"), "accounting");
  assert.equal(departmentVisualFamily("校長"), "principal");
});

test("systemAdmin 自訂單位一律使用中性灰 fallback", () => {
  assert.equal(departmentVisualFamily("家長會"), "custom");
  assert.equal(departmentVisualFamily("臨時專案辦公室"), "custom");
});

test("首頁只將發布單位套用 badge，公告對象維持一般文字", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function DepartmentBadge/);
  assert.match(page, /function DepartmentAudienceMeta/);
  assert.match(page, /<DepartmentBadge department=\{department\} \/>/);
  assert.match(page, /<span>\{audiences\.join\("、"\)\}<\/span>/);
});
