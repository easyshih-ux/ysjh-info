import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  analyticsCookieNames,
  clearAnalyticsCookies,
  readAnalyticsConsent,
  shouldEnableAnalytics,
  writeAnalyticsConsent,
} from "../lib/analyticsConsent.ts";
import { ANALYTICS_CONSENT_DEFAULTS, ANALYTICS_GTAG_CONFIG, createAnalyticsController, hasGlobalPrivacyControl, isPublicAnalyticsAllowed } from "../lib/publicAnalytics.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("未設定偏好時啟用統計，既有拒絕與儲存失敗時維持退出", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.equal(readAnalyticsConsent(storage), null);
  assert.equal(shouldEnableAnalytics(null), true);
  assert.equal(writeAnalyticsConsent(storage, "granted"), true);
  assert.equal(values.get(ANALYTICS_CONSENT_STORAGE_KEY), "granted");
  assert.equal(readAnalyticsConsent(storage), "granted");
  assert.equal(shouldEnableAnalytics("granted"), true);
  assert.equal(shouldEnableAnalytics("denied"), false);
  values.set(ANALYTICS_CONSENT_STORAGE_KEY, "unexpected");
  assert.equal(readAnalyticsConsent(storage), null);

  assert.equal(readAnalyticsConsent({ getItem: () => { throw new Error("blocked"); } }), "denied");
  assert.equal(writeAnalyticsConsent({ setItem: () => { throw new Error("blocked"); } }, "denied"), false);
});

test("撤回同意會辨識並清除 GA cookies，但保留其他 cookie", () => {
  assert.deepEqual(
    analyticsCookieNames("session=keep; _ga=GA1.1.1.1; _ga_ABC=GS1.1; _gid=GID; preference=keep"),
    ["_ga", "_ga_ABC", "_gid"],
  );

  const writes: string[] = [];
  const cookieDocument = {
    get cookie() { return "session=keep; _ga=GA1.1.1.1; _ga_ABC=GS1.1"; },
    set cookie(value: string) { writes.push(value); },
  };
  clearAnalyticsCookies(cookieDocument, "easyshih-ux.github.io");

  assert.equal(writes.length, 18);
  assert.ok(writes.every(value => value.startsWith("_ga") && value.includes("Max-Age=0")));
  assert.ok(writes.some(value => value.includes("Path=/ysjh-info")));
  assert.ok(writes.some(value => value.includes("Domain=easyshih-ux.github.io")));
  assert.ok(writes.every(value => !value.startsWith("session=")));
});

test("Analytics controller 單例化初始化且公告事件每次呼叫只送一次", async () => {
  let loads = 0;
  const collectionStates: boolean[] = [];
  const events: Array<{ name: string; parameters?: Record<string, string> }> = [];
  const controller = createAnalyticsController(async () => {
    loads += 1;
    return {
      setCollectionEnabled: enabled => { collectionStates.push(enabled); },
      logEvent: (name, parameters) => { events.push({ name, parameters }); },
    };
  });

  assert.equal(controller.logAnnouncementOpen("a-1", "latest"), false);
  assert.deepEqual(await Promise.all([controller.enable(), controller.enable()]), [true, true]);
  assert.equal(loads, 1);
  assert.deepEqual(collectionStates, [true]);
  assert.equal(events.some(event => event.name === "page_view"), false);

  assert.equal(controller.logAnnouncementOpen("a-1", "latest"), true);
  assert.deepEqual(events, [{
    name: "announcement_open",
    parameters: { announcement_id: "a-1", source: "latest" },
  }]);

  controller.disable();
  assert.deepEqual(collectionStates, [true, false]);
  assert.equal(controller.logAnnouncementOpen("a-2", "search"), false);
  assert.equal(events.length, 1);
});

test("Analytics 被阻擋或不支援時不拋錯也不送事件", async () => {
  const blocked = createAnalyticsController(async () => { throw new Error("blocked"); });
  const unsupported = createAnalyticsController(async () => null);

  assert.equal(await blocked.enable(), false);
  assert.equal(blocked.logAnnouncementOpen("a-1", "weekly"), false);
  assert.equal(await unsupported.enable(), false);
  assert.equal(unsupported.logAnnouncementOpen("a-1", "weekly"), false);
});

test("前台不再有統計與隱私設定入口；GA4 由無畫面的啟動器在允許時啟動", () => {
  const homepage = source("app/page.tsx");
  const starter = source("components/public-analytics.tsx");
  assert.ok(!existsSync(new URL("../components/analytics-consent.tsx", import.meta.url)), "舊的按鈕元件已移除");
  assert.equal(homepage.match(/<PublicAnalytics \/>/g)?.length, 2, "首頁與首次選身分畫面都會啟動 GA4");
  assert.doesNotMatch(homepage, /統計與隱私設定|AnalyticsConsent|匿名使用統計/);
  assert.match(homepage, /不需要登入，也不會要求姓名或帳號。<\/p>/);
  assert.match(homepage, /Made by WenYi/);
  assert.match(starter, /return null;/, "不顯示任何畫面");
  assert.match(starter, /if \(isPublicAnalyticsAllowed\(\)\) void enablePublicAnalytics\(\);/);
  assert.doesNotMatch(starter, /writeAnalyticsConsent|clearAnalyticsCookies|<button|Dialog/);
  assert.doesNotMatch(source("app/globals.css"), /analytics-preferences-button|analytics-settings-dialog|analytics-consent-/);
});

test("既有退出偏好、儲存空間封鎖與 GPC 都不載入 GA4；不改寫既有偏好", () => {
  assert.equal(hasGlobalPrivacyControl({ globalPrivacyControl: true }), true);
  assert.equal(hasGlobalPrivacyControl({ globalPrivacyControl: false }), false);
  assert.equal(hasGlobalPrivacyControl({}), false);
  assert.equal(hasGlobalPrivacyControl(undefined), false);
  assert.equal(isPublicAnalyticsAllowed(), false, "沒有瀏覽器環境時不統計");
  const analytics = source("lib/publicAnalytics.ts");
  const allowed = analytics.slice(analytics.indexOf("export function isPublicAnalyticsAllowed"), analytics.indexOf("export const ANALYTICS_CONSENT_DEFAULTS"));
  assert.match(allowed, /try \{ storage = window\.localStorage; \} catch \{ return false; \}/);
  assert.match(allowed, /shouldEnableAnalytics\(readAnalyticsConsent\(storage\)\) && !hasGlobalPrivacyControl\(/);
  assert.doesNotMatch(analytics, /writeAnalyticsConsent|removeItem|clearAnalyticsCookies/);
  const loader = analytics.slice(analytics.indexOf("async function loadFirebaseAnalyticsRuntime"), analytics.indexOf("const publicAnalyticsController"));
  assert.ok(loader.indexOf("isPublicAnalyticsAllowed()") < loader.indexOf('import("firebase/analytics")'), "不允許時連 GA4 程式都不下載");
  assert.match(source("lib/publicAnalytics.ts"), /export async function trackAnnouncementOpen[\s\S]*if \(!isPublicAnalyticsAllowed\(\)\) return false;/);
});

test("只保留統計用 Cookie：關閉廣告儲存、廣告個人化與 Google Signals，且在初始化前套用", () => {
  assert.deepEqual(ANALYTICS_CONSENT_DEFAULTS, { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" });
  assert.deepEqual(ANALYTICS_GTAG_CONFIG, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const analytics = source("lib/publicAnalytics.ts");
  const loader = analytics.slice(analytics.indexOf("async function loadFirebaseAnalyticsRuntime"), analytics.indexOf("const publicAnalyticsController"));
  assert.ok(loader.indexOf("setConsent({ ...ANALYTICS_CONSENT_DEFAULTS })") > 0);
  assert.ok(loader.indexOf("setConsent(") < loader.indexOf("initializeAnalytics("));
  assert.match(loader, /initializeAnalytics\(getFirebaseApp\(\), \{ config: \{ \.\.\.ANALYTICS_GTAG_CONFIG \} \}\)/);
  assert.doesNotMatch(analytics, /setUserId|setUserProperties|getAnalytics\(/);
});

test("Analytics 僅掛載在公開首頁且管理路由沒有追蹤元件", () => {
  for (const path of ["app/admin/page.tsx", "app/publish/page.tsx", "app/manage/layout.tsx", "app/manage/page.tsx"]) {
    const route = source(path);
    assert.doesNotMatch(route, /PublicAnalytics|AnalyticsConsent|publicAnalytics|trackAnnouncementOpen/);
  }
});

test("公告開啟集中處理並只傳送允許的事件參數", () => {
  const homepage = source("app/page.tsx");
  const analytics = source("lib/publicAnalytics.ts");
  const handler = homepage.match(/const openAnnouncement = [\s\S]*?\n  };/)?.[0] ?? "";

  assert.match(handler, /trackAnnouncementOpen\(announcement\.id, source\)/);
  assert.match(handler, /setSelected\(announcement\)/);
  assert.doesNotMatch(homepage, /onClick=\{\(\) => setSelected\(/);
  for (const eventSource of ["chasing", "weekly", "next_week", "deadline", "latest", "search"]) {
    assert.match(homepage, new RegExp(`openAnnouncement\\([^\\n]+, "${eventSource}"\\)`));
  }

  const eventParameters = analytics.match(/runtime\.logEvent\("announcement_open", \{[\s\S]*?\n    }\);/)?.[0] ?? "";
  assert.match(eventParameters, /announcement_id/);
  assert.match(eventParameters, /source/);
  assert.doesNotMatch(eventParameters, /title|content|email|uid|query|identity/i);
});

test("Measurement ID 經公開環境變數注入並由 Actions 驗證", () => {
  const firebaseClient = source("lib/firebaseClient.ts");
  const workflow = source(".github/workflows/deploy-pages.yml");
  const example = source(".env.local.example");

  assert.match(firebaseClient, /measurementId: process\.env\.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID/);
  assert.match(workflow, /NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID:.*vars\.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID/);
  assert.match(workflow, /test -n "\$NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID"/);
  assert.match(example, /NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-L4PRSDQX55/);
});
