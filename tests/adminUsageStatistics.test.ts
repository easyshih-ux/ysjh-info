import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("systemAdmin 才會在行政工作台看到網站使用統計入口", () => {
  const page = source("app/admin/page.tsx");
  assert.match(page, /isSystemAdmin && <Link href="\/admin\/analytics">/);
  assert.match(page, /網站使用統計/);
});

test("統計頁共用 AdminAuthGuard 並再次限制 systemAdmin", () => {
  const page = source("app/admin/analytics/page.tsx");
  assert.match(page, /<AdminAuthGuard>/);
  assert.match(page, /publisher\.role !== "systemAdmin"/);
  assert.match(page, /此功能僅供系統管理員使用。/);
  assert.match(page, /<AnalyticsDashboard \/>/);
});

test("統計資料只經 asia-east1 Callable 取得且不直接存取 Firestore", () => {
  const repository = source("lib/adminUsageStatistics.ts");
  assert.match(repository, /getFunctions\(getFirebaseApp\(\), "asia-east1"\)/);
  assert.match(repository, /"getAdminUsageStatistics"/);
  assert.match(repository, /await callable\(\{\}\)/);
  assert.doesNotMatch(repository, /getFirestore|setDoc|updateDoc|addDoc|deleteDoc/);
});

test("統計頁提供四張 KPI、七日趨勢、快取提示與失敗重試", () => {
  const page = source("app/admin/analytics/page.tsx");
  for (const label of ["今日訪客估計數", "今日網站瀏覽次數", "近七日訪客估計數", "近七日公告開啟次數"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /最近七日每日使用趨勢/);
  assert.match(page, /使用五分鐘快取/);
  assert.match(page, /重新嘗試/);
  assert.match(page, /七日區間獨立去重，非每日加總/);
  assert.doesNotMatch(page, /姓名|Email|UID|處室排名/);
});

test("新 Callable 固定安全執行設定並在後端重讀 systemAdmin", () => {
  const backend = source("functions/src/adminUsageStatistics.ts");
  assert.match(backend, /region: REGION/);
  assert.match(backend, /minInstances: 0/);
  assert.match(backend, /serviceAccount: REPORTING_SERVICE_ACCOUNT/);
  assert.match(backend, /ysjh-ga4-reporting@ysjh-public-affairs\.iam\.gserviceaccount\.com/);
  assert.match(backend, /collection\("authorizedPublishers"\)\.doc\(callerUid\)\.get\(\)/);
  assert.match(backend, /data\?\.enabled !== true \|\| data\.role !== "systemAdmin"/);
  assert.doesNotMatch(backend, /FieldValue|runTransaction|setDoc|updateDoc|deleteDoc|addDoc/);
});
