import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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
  assert.match(page, /待審申請/);
  assert.match(page, /state\.requests\.length/);
  assert.match(page, /目前沒有待核准的發布權限申請。/);
  assert.match(page, /目前無法讀取發布權限申請，請稍後再試。/);
  assert.doesNotMatch(page, /error\.message|FirebaseError/);
});

test("發布者管理資料層透過 asia-east1 callable，不由 browser 直寫 Firestore", () => {
  const repository = source("lib/publisherRequestManagement.ts");
  assert.match(repository, /listPublisherManagement/);
  assert.match(repository, /managePublisherAccess/);
  assert.match(repository, /getFunctions\(getFirebaseApp\(\), "asia-east1"\)/);
  assert.doesNotMatch(repository, /setDoc|updateDoc|deleteDoc/);
});

test("pending 申請使用22個固定單位與其他並提供防重複核准狀態", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /standaloneDepartments\.map/);
  assert.match(page, /departmentGroups\.flatMap/);
  assert.match(page, /OTHER_DEPARTMENT_OPTION/);
  assert.match(page, /核准發布權限/);
  assert.match(page, /核准處理中…/);
  assert.match(page, /disabled=\{busyAction !== null/);
});

test("下拉顯示層級文字但 option value 維持正式單位名稱", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /value=\{group\.office\}>【\{group\.office\}】/);
  assert.match(page, /value=\{department\}>　\{department\}/);
});

test("發布單位沿用申請選擇，其他未填實際名稱時不得核准", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /request\.requestedDepartment/);
  assert.match(page, /<option value="" disabled>請選擇發布單位<\/option>/);
  assert.match(page, /實際發布單位名稱/);
  assert.match(page, /resolveDepartmentSelection/);
  assert.doesNotMatch(page, /departments\[targetUid\] \?\? DEPARTMENTS\[0\]/);
});

test("選擇有效單位後以該單位核准並維持 refresh", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /event\.target\.value as Department/);
  assert.match(page, /await approvePublisherRequest\(targetUid, defaultDepartment\)/);
  assert.match(page, /await state\.refresh\(\)/);
});

test("Callable 固定 asia-east1 且 payload 只有 targetUid 與 defaultDepartment", () => {
  const repository = source("lib/publisherRequestManagement.ts");
  const callable = repository.match(/export async function approvePublisherRequest[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(repository, /getFunctions\(getFirebaseApp\(\), "asia-east1"\)/);
  assert.match(repository, /httpsCallable\(functions\(\), "approvePublisherRequest"\)/);
  assert.match(repository, /await callable\(\{ targetUid, defaultDepartment \}\)/);
  assert.doesNotMatch(callable, /email|displayName|role|enabled/);
});

test("核准成功後刷新 pending 清單，失敗顯示友善訊息並保留 console error", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /await state\.refresh\(\)/);
  assert.match(page, /發布權限已核准。/);
  assert.match(page, /目前無法核准發布權限，請稍後再試。/);
  assert.match(page, /console\.error\("approvePublisherRequest failed", error\)/);
});

test("待審申請可拒絕且操作後刷新清單", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /rejectPublisherRequest\(targetUid\)/);
  assert.match(page, /拒絕申請/);
  assert.match(page, /申請已拒絕。/);
});

test("現有 publisher 可停用、重新啟用並更換固定或其他單位", () => {
  const page = source("app/admin/publishers/page.tsx");
  const repository = source("lib/publisherRequestManagement.ts");
  assert.match(page, /停用發布權限/);
  assert.match(page, /重新啟用/);
  assert.match(page, /儲存單位/);
  assert.match(page, /resolveDepartmentSelection/);
  assert.match(repository, /setPublisherEnabled/);
  assert.match(repository, /changePublisherDepartment/);
  assert.match(repository, /if \(!isDepartment\(defaultDepartment\)\)/);
});

test("systemAdmin 帳號只顯示不可變更，管理操作失敗不會默默成功", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /item\.role === "systemAdmin"/);
  assert.match(page, /disabled=\{busyAction !== null \|\| item\.role === "systemAdmin"\}/);
  assert.match(page, /操作失敗，資料未變更，請稍後再試。/);
  assert.match(page, /console\.error\("publisher management action failed", error\)/);
});

test("現有發布者可即時搜尋姓名 Email 與發布單位並依狀態篩選", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /publisherQuery/);
  assert.match(page, /item\.displayName/);
  assert.match(page, /item\.email/);
  assert.match(page, /item\.defaultDepartment/);
  assert.match(page, /publisherStatus === "enabled" \? item\.enabled : !item\.enabled/);
  assert.match(page, /<option value="all">全部<\/option>/);
  assert.match(page, /<option value="enabled">啟用中<\/option>/);
  assert.match(page, /<option value="disabled">已停用<\/option>/);
});

test("現有發布者預設收合並在摘要顯示姓名單位狀態與 Email", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /filteredPublishers\.map\(item => <details/);
  assert.doesNotMatch(page, /<details[^>]*open/);
  assert.match(page, /<summary>/);
  assert.match(page, /item\.defaultDepartment \|\| "尚未設定單位"/);
  assert.match(page, /item\.email \|\| "帳號 email 尚未同步"/);
  assert.match(page, /停用發布權限/);
  assert.match(page, /重新啟用/);
  assert.match(page, /儲存單位/);
});

test("待審維持上方並顯示兩區數量與篩選空狀態", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.ok(page.indexOf("待審申請（") < page.indexOf("現有發布者（"));
  assert.match(page, /待審申請（\{state\.requests\.length\}）/);
  assert.match(page, /現有發布者（\{state\.publishers\.length\}）/);
  assert.match(page, /沒有符合搜尋或篩選條件的發布者。/);
});
