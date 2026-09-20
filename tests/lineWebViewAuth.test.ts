import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLineWebView } from "../lib/browserEnvironment.ts";
import { copyOfficialPublicSiteUrl, OFFICIAL_PUBLIC_SITE_URL } from "../lib/siteUrl.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Chrome 不會被辨識為 LINE 內建瀏覽器", () => {
  const chrome = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";
  assert.equal(isLineWebView(chrome), false);
});

test("Safari 不會被辨識為 LINE 內建瀏覽器", () => {
  const safari = "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1";
  assert.equal(isLineWebView(safari), false);
});

test("LINE WebView 會被集中 helper 正確辨識", () => {
  const lineAndroid = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36 Line/15.15.1";
  const lineIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/15.15.0";
  assert.equal(isLineWebView(lineAndroid), true);
  assert.equal(isLineWebView(lineIos), true);
});

test("LINE 點行政登入只開啟提示，不呼叫 signInWithPopup", () => {
  const hook = source("hooks/use-firebase-auth.ts");
  const login = hook.match(/const login = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] ?? "";
  const lineBranch = login.match(/if \(shouldWarnBeforeGoogleLogin\(\)\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";

  assert.match(lineBranch, /setLineLoginWarningOpen\(true\)/);
  assert.match(lineBranch, /return/);
  assert.doesNotMatch(lineBranch, /signInWithPopup/);
  assert.match(login, /await signInWithPopup\(auth, provider\)/);
});

test("LINE 登入提示提供複製網站網址與關閉操作", () => {
  const warning = source("components/firebase-auth-login-warning.tsx");
  assert.match(warning, /請使用瀏覽器登入/);
  assert.match(warning, /LINE 內建瀏覽器可能無法正常完成 Google 登入/);
  assert.match(warning, /請複製網站網址，使用 Chrome 或 Safari 開啟後，再進行行政登入/);
  assert.match(warning, /複製網站網址/);
  assert.match(warning, />關閉<\/button>/);
  assert.doesNotMatch(warning, /繼續嘗試登入|signInWithPopup/);
});

test("複製按鈕固定複製正式首頁網址，不使用目前 location", async () => {
  let copied = "";
  const result = await copyOfficialPublicSiteUrl({ writeText: async value => { copied = value; } });

  assert.equal(result, true);
  assert.equal(copied, "https://easyshih-ux.github.io/ysjh-info/");
  assert.equal(copied, OFFICIAL_PUBLIC_SITE_URL);
  assert.doesNotMatch(copied, /\/admin|[?#]/);
  assert.doesNotMatch(source("components/firebase-auth-login-warning.tsx"), /window\.location|location\.href/);
});

test("複製成功顯示成功狀態且不關閉 Dialog", () => {
  const warning = source("components/firebase-auth-login-warning.tsx");
  assert.match(warning, /✓ 網址已複製，請貼到 Chrome 或 Safari 開啟/);
  assert.match(warning, /setCopyStatus\(copied \? "success" : "failure"\)/);
  assert.doesNotMatch(warning.match(/const copySiteUrl = async \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "", /onClose/);
});

test("Clipboard 不可用或拋出錯誤時安全失敗並顯示手動複製網址", async () => {
  assert.equal(await copyOfficialPublicSiteUrl({ writeText: async () => { throw new Error("blocked"); } }), false);
  assert.equal(await copyOfficialPublicSiteUrl(undefined), false);

  const warning = source("components/firebase-auth-login-warning.tsx");
  assert.match(warning, /無法自動複製，請手動複製下方網址：/);
  assert.match(warning, /OFFICIAL_PUBLIC_SITE_URL/);
});

test("公開首頁不依賴 LINE 偵測或行政登入流程", () => {
  const homepage = source("app/page.tsx");
  assert.doesNotMatch(homepage, /isLineWebView|shouldWarnBeforeGoogleLogin|signInWithPopup|useFirebaseAuth/);
});
