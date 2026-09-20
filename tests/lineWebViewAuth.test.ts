import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLineWebView } from "../lib/browserEnvironment.ts";

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

test("LINE 登入提示使用指定文字且只有關閉操作", () => {
  const warning = source("components/firebase-auth-login-warning.tsx");
  assert.match(warning, /請使用瀏覽器登入/);
  assert.match(warning, /LINE 內建瀏覽器可能無法正常完成 Google 登入/);
  assert.match(warning, /請使用 Chrome 或 Safari 開啟本網站後，再進行行政登入/);
  assert.match(warning, />關閉<\/button>/);
  assert.doesNotMatch(warning, /繼續嘗試登入|signInWithPopup/);
});

test("公開首頁不依賴 LINE 偵測或行政登入流程", () => {
  const homepage = source("app/page.tsx");
  assert.doesNotMatch(homepage, /isLineWebView|shouldWarnBeforeGoogleLogin|signInWithPopup|useFirebaseAuth/);
});

