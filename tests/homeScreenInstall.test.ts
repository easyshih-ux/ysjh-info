import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { browserLocalStorage, getInstallGuidance, INSTALL_BANNER_DISMISSED_KEY, INSTALL_STEPS, isIosDevice, isSafariBrowser, isStandaloneDisplay, readInstallBannerDismissed, writeInstallBannerDismissed } from "../lib/pwaInstall.ts";
import { copyOfficialPublicSiteUrl, OFFICIAL_PUBLIC_SITE_URL } from "../lib/siteUrl.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chrome = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";
const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1";
const line = `${chrome} Line/15.15.1`;

test("Header 使用正式 icon 並在站名下方放置小型安裝入口", () => {
  const page = source("app/page.tsx");
  assert.match(page, /className="brand-mark" src="\/ysjh-info\/icons\/icon-192\.png"/);
  assert.match(page, /<h1>義學公務資訊站<\/h1><HomeScreenInstall \/>/);
  assert.match(source("components/home-screen-install.tsx"), />安裝義學公務<\/button>/);
});

test("standalone 與 iOS standalone 都會隱藏安裝入口", () => {
  assert.equal(isStandaloneDisplay(true, false), true);
  assert.equal(isStandaloneDisplay(false, true), true);
  assert.equal(isStandaloneDisplay(false, false), false);
  const component = source("components/home-screen-install.tsx");
  assert.match(component, /INSTALLED_DISPLAY_MODES\.some\(mode => window\.matchMedia\(`\(display-mode: \$\{mode\}\)`\)\.matches\)/);
  assert.match(source("lib/pwaInstall.ts"), /INSTALLED_DISPLAY_MODES = \["standalone", "fullscreen", "minimal-ui"\]/);
  assert.match(component, /navigator\.standalone/);
  assert.match(component, /if \(!visible\) return null/);
});

const ua = {
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  iosEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/140.0.0.0 Mobile/15E148 Safari/605.1.15",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
  samsung: "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
  iosLine: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/15.15.1",
};

test("裝置辨識：iPhone Safari／其他、iPad、Samsung、Android、電腦 Chrome／Edge、LINE 各自對應", () => {
  assert.equal(isSafariBrowser(safari), true);
  assert.equal(isSafariBrowser(chrome), false);
  assert.equal(isSafariBrowser(ua.samsung), false);
  assert.equal(getInstallGuidance(safari), "ios-safari");
  assert.equal(getInstallGuidance(ua.iosChrome), "ios-other");
  assert.equal(getInstallGuidance(ua.iosEdge), "ios-other");
  assert.equal(isIosDevice(ua.ipadDesktop, 5), true, "iPadOS 桌面版 UA 以觸控點判斷");
  assert.equal(getInstallGuidance(ua.ipadDesktop, 5), "ios-safari");
  assert.equal(getInstallGuidance(ua.macSafari, 0), "browser", "Mac Safari 不是 iPad");
  assert.equal(getInstallGuidance(ua.samsung), "samsung");
  assert.equal(getInstallGuidance(chrome), "android");
  assert.equal(getInstallGuidance(ua.windowsChrome), "desktop");
  assert.equal(getInstallGuidance(ua.windowsEdge), "desktop");
  assert.equal(getInstallGuidance(line), "line");
  assert.equal(getInstallGuidance(ua.iosLine), "line", "LINE 優先於 iPhone 判斷");
});

test("每種裝置都有完整安裝步驟，iPhone 說明加入主畫面", () => {
  for (const [key, value] of Object.entries(INSTALL_STEPS)) {
    assert.ok(value.title && value.steps.length >= 3, key);
    assert.ok(value.steps.every(step => step.trim() === step && step.length > 0), key);
  }
  assert.match(INSTALL_STEPS["ios-safari"].steps.join(""), /分享[\s\S]*加入主畫面/);
  assert.match(INSTALL_STEPS["ios-other"].note ?? "", /Safari/);
  assert.match(INSTALL_STEPS.samsung.steps.join(""), /主畫面/);
  assert.match(INSTALL_STEPS.android.steps.join(""), /安裝應用程式|加到主畫面/);
  assert.match(INSTALL_STEPS.desktop.steps.join(""), /網址列右側/);
});

test("「不再提醒」只寫入本站前綴的 localStorage，讀寫失敗不讓頁面出錯", () => {
  assert.equal(INSTALL_BANNER_DISMISSED_KEY, "ysjh-info:install-banner-dismissed");
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  assert.equal(readInstallBannerDismissed(storage), false);
  assert.equal(writeInstallBannerDismissed(storage), true);
  assert.equal(readInstallBannerDismissed(storage), true);
  assert.deepEqual([...map.keys()], [INSTALL_BANNER_DISMISSED_KEY]);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readInstallBannerDismissed(broken), false, "讀取失敗時照常顯示");
  assert.equal(writeInstallBannerDismissed(broken), false);
  assert.equal(readInstallBannerDismissed(null), false);
  assert.equal(writeInstallBannerDismissed(undefined), false);
  assert.equal(browserLocalStorage(), null, "沒有 window 時安全回傳 null");
});

test("首頁橫幅：位於身分列下方、公告內容上方；首次選身分畫面不顯示", () => {
  const page = source("app/page.tsx");
  assert.match(page, /<div className="identity-toolbar">[\s\S]*?<\/div>\n\s*<div className="page-shell">\n\s*<HomeScreenInstall variant="banner" \/>\n\s*\{deepLinkNotice &&/);
  const identityScreen = page.slice(page.indexOf("if (identity === null)"), page.indexOf("return <><main>\n"));
  assert.doesNotMatch(identityScreen, /HomeScreenInstall/);
  assert.equal(page.match(/<HomeScreenInstall/g)?.length, 2, "頁首小按鈕與首頁橫幅各一");
  assert.match(page, /Made by WenYi/);
  const component = source("components/home-screen-install.tsx");
  assert.match(component, /📲 把義學公務資訊站放到桌面！/);
  assert.match(component, /像 APP 一樣快速開啟，不用再翻 LINE 找網址。/);
  assert.match(component, />立即安裝／查看步驟<\/button>/);
  assert.match(component, />不再提醒<\/button>/);
});

test("「不再提醒」只影響橫幅，頁首小按鈕照常顯示；不寫入 Firebase、不主動跳出視窗", () => {
  const component = source("components/home-screen-install.tsx");
  assert.match(component, /if \(variant === "banner" && readInstallBannerDismissed\(browserLocalStorage\(\)\)\) return;/);
  const dismiss = component.slice(component.indexOf("const dismissBanner"), component.indexOf("const steps"));
  assert.match(dismiss, /writeInstallBannerDismissed\(browserLocalStorage\(\)\);\n\s*setVisible\(false\);/);
  const code = component.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(code, /firebase|firestore|gtag|trackEvent|publicAnalytics/i);
  // 說明視窗只在點擊後由 requestInstall 開啟。
  const effect = component.slice(component.indexOf("useEffect("), component.indexOf("if (!visible) return null"));
  assert.doesNotMatch(effect, /setGuidance\((?!null)/);
  assert.doesNotMatch(effect, /\.prompt\(\)/);
});

test("beforeinstallprompt 使用原生安裝，appinstalled 後隱藏入口", () => {
  const component = source("components/home-screen-install.tsx");
  assert.match(component, /event\.preventDefault\(\)/);
  assert.match(component, /await installPrompt\.prompt\(\)/);
  assert.match(component, /await installPrompt\.userChoice/);
  assert.match(component, /addEventListener\("appinstalled", installed\)/);
  assert.match(component, /setVisible\(false\)/);
});

test("LINE 不觸發原生安裝，Safari 與桌面 fallback 顯示對應說明", () => {
  const component = source("components/home-screen-install.tsx");
  const lineBranch = component.match(/if \(environment === "line"\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(lineBranch, /setGuidance\("line"\)/);
  assert.match(lineBranch, /return/);
  assert.doesNotMatch(lineBranch, /installPrompt\.prompt/);
  assert.match(component, /INSTALL_STEPS\[guidance\]/);
  assert.match(component, /catch \{\n\s*setGuidance\(environment\);/, "原生提示失敗時改顯示該裝置步驟");
  assert.match(component, /LINE 內建瀏覽器無法安裝義學公務/);
  assert.match(component, /OFFICIAL_PUBLIC_SITE_URL/);
  assert.doesNotMatch(component, /window\.open|location\.href|intent:/);
});

test("LINE 安裝引導重用正式網址與安全 Clipboard fallback", async () => {
  let copied = "";
  assert.equal(await copyOfficialPublicSiteUrl({ writeText: async value => { copied = value; } }), true);
  assert.equal(copied, OFFICIAL_PUBLIC_SITE_URL);
  assert.equal(await copyOfficialPublicSiteUrl({ writeText: async () => { throw new Error("blocked"); } }), false);
  const component = source("components/home-screen-install.tsx");
  assert.match(component, /✓ 網址已複製！請開啟 Chrome 或 Safari貼上即可。/);
  assert.match(component, /無法自動複製，請長按上方網址手動複製。/);
  assert.match(component, /<code>\{OFFICIAL_PUBLIC_SITE_URL\}<\/code>/);
  assert.equal(component.match(/https:\/\/easyshih-ux\.github\.io\/ysjh-info\//g)?.length ?? 0, 0);
});

test("沒有新增 Service Worker 或離線快取", () => {
  const combined = `${source("components/home-screen-install.tsx")}\n${source("app/page.tsx")}`;
  assert.doesNotMatch(combined, /serviceWorker|service-worker|workbox|offline/i);
});
