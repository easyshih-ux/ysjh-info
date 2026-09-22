import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("公開詳細頁與管理頁只依 contentUpdatedAt 顯示原文更新", () => {
  const home = source("app/page.tsx");
  const manage = source("app/manage/page.tsx");
  assert.match(home, /selected\.contentUpdatedAt/);
  assert.doesNotMatch(home, /selected\.updatedAt/);
  assert.match(manage, /item\.contentUpdatedAt/);
  assert.doesNotMatch(manage, /item\.updatedAt\s*&&\s*<span>更新/);
});

test("補充提醒與 lifecycle 操作不寫入原文更新時間", () => {
  const management = source("lib/announcementManagementFirestore.ts");
  const lifecycle = source("functions/src/index.ts");
  const followUpPatch = management.slice(management.indexOf("export async function appendManagedFollowUp"));
  assert.doesNotMatch(followUpPatch, /updatedAt|contentUpdatedAt/);
  assert.doesNotMatch(lifecycle, /contentUpdatedAt/);
});

test("無實質變更不寫 Firestore，成功原文編輯才同步 contentUpdatedAt", () => {
  const management = source("lib/announcementManagementFirestore.ts");
  const model = source("lib/announcementManagement.ts");
  assert.match(management, /if \(!hasAnnouncementContentChanges\(original, edited\)\) return null/);
  assert.match(model, /updatedAt: contentUpdatedAt, contentUpdatedAt/);
});
