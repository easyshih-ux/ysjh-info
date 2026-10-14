import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  analyticsCookieNames,
  clearAnalyticsCookies,
  readAnalyticsConsent,
  writeAnalyticsConsent,
} from "../lib/analyticsConsent.ts";
import { createAnalyticsController } from "../lib/publicAnalytics.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("統計同意只接受明確 granted 或 denied，儲存失敗時安全降級", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.equal(readAnalyticsConsent(storage), null);
  assert.equal(writeAnalyticsConsent(storage, "granted"), true);
  assert.equal(values.get(ANALYTICS_CONSENT_STORAGE_KEY), "granted");
  assert.equal(readAnalyticsConsent(storage), "granted");
  values.set(ANALYTICS_CONSENT_STORAGE_KEY, "unexpected");
  assert.equal(readAnalyticsConsent(storage), null);

  assert.equal(readAnalyticsConsent({ getItem: () => { throw new Error("blocked"); } }), null);
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

test("未同意與拒絕狀態不初始化，公開首頁提供可隨時變更的入口", () => {
  const component = source("components/analytics-consent.tsx");
  assert.match(component, /savedConsent === "granted"/);
  assert.match(component, /同意統計/);
  assert.match(component, /暫不同意/);
  assert.match(component, /撤回同意並停止統計/);
  assert.match(component, /統計與隱私設定/);
  assert.match(component, /不同意不影響網站功能/);
  assert.doesNotMatch(component, /advanced|進階 Consent Mode/i);
});

test("Analytics 僅掛載在公開首頁且管理路由沒有追蹤元件", () => {
  const homepage = source("app/page.tsx");
  assert.match(homepage, /<AnalyticsConsent \/>/);
  for (const path of ["app/admin/page.tsx", "app/publish/page.tsx", "app/manage/layout.tsx", "app/manage/page.tsx"]) {
    const route = source(path);
    assert.doesNotMatch(route, /AnalyticsConsent|publicAnalytics|trackAnnouncementOpen/);
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
