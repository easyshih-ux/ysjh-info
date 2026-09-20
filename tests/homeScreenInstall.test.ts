import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getInstallGuidance, isSafariBrowser, isStandaloneDisplay } from "../lib/pwaInstall.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chrome = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";
const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1";
const line = `${chrome} Line/15.15.1`;

test("Header 使用正式 icon 並在站名下方放置小型安裝入口", () => {
  const page = source("app/page.tsx");
  assert.match(page, /className="brand-mark" src="\/ysjh-info\/icons\/icon-192\.png"/);
  assert.match(page, /<h1>義學公務資訊站<\/h1><HomeScreenInstall \/>/);
});

test("standalone 與 iOS standalone 都會隱藏安裝入口", () => {
  assert.equal(isStandaloneDisplay(true, false), true);
  assert.equal(isStandaloneDisplay(false, true), true);
  assert.equal(isStandaloneDisplay(false, false), false);
  const component = source("components/home-screen-install.tsx");
  assert.match(component, /matchMedia\("\(display-mode: standalone\)"\)/);
  assert.match(component, /navigator\.standalone/);
  assert.match(component, /if \(!visible\) return null/);
});

test("Safari、LINE 與一般瀏覽器使用正確安裝引導", () => {
  assert.equal(isSafariBrowser(safari), true);
  assert.equal(isSafariBrowser(chrome), false);
  assert.equal(getInstallGuidance(safari), "safari");
  assert.equal(getInstallGuidance(line), "line");
  assert.equal(getInstallGuidance(chrome), "browser");
});

test("beforeinstallprompt 使用原生安裝，appinstalled 後隱藏入口", () => {
  const component = source("components/home-screen-install.tsx");
  assert.match(component, /event\.preventDefault\(\)/);
  assert.match(component, /await installPrompt\.prompt\(\)/);
  assert.match(component, /await installPrompt\.userChoice/);
  assert.match(component, /addEventListener\("appinstalled", installed\)/);
  assert.match(component, /setVisible\(false\)/);
});

test("LINE 不觸發原生安裝，Safari 與 fallback 顯示簡短說明", () => {
  const component = source("components/home-screen-install.tsx");
  const lineBranch = component.match(/if \(environment === "line"\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(lineBranch, /setGuidance\("line"\)/);
  assert.match(lineBranch, /return/);
  assert.doesNotMatch(lineBranch, /installPrompt\.prompt/);
  assert.match(component, /分享.*加入主畫面/);
  assert.match(component, /安裝應用程式.*新增至主畫面/);
  assert.match(component, /請改用 Chrome 或 Safari 開啟/);
});

test("沒有新增 Service Worker 或離線快取", () => {
  const combined = `${source("components/home-screen-install.tsx")}\n${source("app/page.tsx")}`;
  assert.doesNotMatch(combined, /serviceWorker|service-worker|workbox|offline/i);
});
