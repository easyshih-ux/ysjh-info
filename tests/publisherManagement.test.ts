import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("systemAdmin 才會在行政工作台看到發布者管理入口", () => {
  const page = source("app/admin/page.tsx");
  assert.match(page, /isSystemAdmin = publisher\.role === "systemAdmin"/);
  assert.match(page, /usePublisherRequests\(isSystemAdmin\)/);
  assert.match(page, /href="\/admin\/publishers"/);
  assert.match(page, /發布者管理/);
});

test("行政工作台依真實 pending 數量顯示待審摘要且妥善處理載入與失敗", () => {
  const page = source("app/admin/page.tsx");
  const backend = source("functions/src/index.ts");
  assert.match(page, /publisherManagement\.status === "loading"/);
  assert.match(page, /正在確認待審申請…/);
  assert.match(page, /待審狀態暫時無法讀取，仍可進入管理/);
  assert.match(page, /publisherManagement\.requests\.length === 0/);
  assert.match(page, /目前無待審申請/);
  assert.match(page, /待審 \{publisherManagement\.requests\.length\}/);
  assert.match(page, /有 \$\{publisherManagement\.requests\.length\} 筆發布權限申請待處理/);
  assert.match(backend, /data\.status !== "pending"/);
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
  assert.match(page, /DepartmentOptionGroups includeOther/);
  assert.match(page, /核准發布權限/);
  assert.match(page, /核准處理中…/);
  assert.match(page, /disabled=\{busyAction !== null/);
});

test("下拉使用原生 optgroup 且 option value 維持正式單位名稱", () => {
  const component = source("components/department-option-groups.tsx");
  assert.match(component, /<optgroup label="校級／獨立單位">/);
  assert.match(component, /label=\{group\.office\}/);
  assert.match(component, /value=\{department\}>\{department\}/);
});

test("發布單位沿用申請選擇，其他未填實際名稱時不得核准", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /request\.requestedDepartment/);
  assert.match(page, /<option value="" disabled>請選擇發布單位<\/option>/);
  assert.match(page, /實際發布單位名稱/);
  assert.match(page, /resolveDepartmentSelection/);
  assert.doesNotMatch(page, /departments\[targetUid\] \?\? DEPARTMENTS\[0\]/);
  assert.match(page, /<DepartmentOptionGroups includeOther \/>/);
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

test("最高管理權移交只列 enabled publisher 並要求二次確認", () => {
  const page = source("app/admin/publishers/page.tsx");
  assert.match(page, /最高管理權移交/);
  assert.match(page, /item\.uid !== publisher\.uid && item\.enabled && item\.role === "publisher" && item\.email\.trim\(\) && item\.defaultDepartment/);
  assert.match(page, /移交後，對方將取得最高管理權限；你目前的最高管理權限將被移除，但仍保留一般發布者資格。/);
  assert.match(page, /確認移交最高管理權/);
  assert.doesNotMatch(page, /手動輸入 UID/);
});

test("移交使用 asia-east1 Callable 且成功後立即刷新權限並離開專屬頁面", () => {
  const page = source("app/admin/publishers/page.tsx");
  const repository = source("lib/publisherRequestManagement.ts");
  assert.match(repository, /httpsCallable<\{ targetUid: string \}, \{ success: true \}>\(functions\(\), "transferSystemAdmin"\)/);
  assert.match(repository, /await callable\(\{ targetUid \}\)/);
  assert.match(page, /await transferSystemAdmin\(transferTarget\.uid\)/);
  assert.match(page, /publisher\.refreshAuthorization\(\)/);
  assert.match(page, /router\.replace\("\/admin"\)/);
  assert.match(page, /最高管理權移交失敗，雙方權限均未變更/);
});

test("一般發布者管理仍禁止停用或降級 systemAdmin", () => {
  const backend = source("functions/src/index.ts");
  assert.match(backend, /if \(profile\?\.role === "systemAdmin"\)/);
  assert.match(backend, /不能透過發布者管理變更系統管理員帳號。/);
});
