import { isLineWebView } from "./browserEnvironment.ts";

export function isStandaloneDisplay(displayModeStandalone: boolean, navigatorStandalone?: boolean) {
  return displayModeStandalone || navigatorStandalone === true;
}

/** 已安裝的 PWA 可能以 standalone、fullscreen 或 minimal-ui 開啟；iOS 另以 navigator.standalone 判斷。 */
export const INSTALLED_DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui"] as const;

export function isSafariBrowser(userAgent: string) {
  return /Safari\//i.test(userAgent)
    && !/(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|Firefox|FxiOS|SamsungBrowser)\//i.test(userAgent)
    && !isLineWebView(userAgent);
}

/**
 * 安裝說明分類：
 * line＝LINE 內建瀏覽器（無法安裝）；ios-safari／ios-other＝iPhone、iPad；samsung＝Samsung Internet；
 * android＝Android Chrome 等；desktop＝電腦版 Chrome／Edge；browser＝其他瀏覽器的通用說明。
 */
export type InstallGuidance = "line" | "ios-safari" | "ios-other" | "samsung" | "android" | "desktop" | "browser";

/** iPadOS 預設以桌面版 UA 回報，需搭配觸控點數判斷。 */
export function isIosDevice(userAgent: string, maxTouchPoints = 0) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function getInstallGuidance(userAgent: string, maxTouchPoints = 0): InstallGuidance {
  if (isLineWebView(userAgent)) return "line";
  if (isIosDevice(userAgent, maxTouchPoints)) return isSafariBrowser(userAgent) ? "ios-safari" : "ios-other";
  if (/SamsungBrowser\//i.test(userAgent)) return "samsung";
  if (/Android/i.test(userAgent)) return "android";
  if (/(?:Chrome|Edg)\//i.test(userAgent) && /Windows|Macintosh|Linux|CrOS/i.test(userAgent)) return "desktop";
  return "browser";
}

/** 依裝置顯示的手動安裝步驟（不支援或未提供原生安裝提示時使用）。 */
export const INSTALL_STEPS: Record<Exclude<InstallGuidance, "line">, { title: string; steps: string[]; note?: string }> = {
  "ios-safari": { title: "iPhone／iPad（Safari）", steps: ["點畫面下方的「分享」按鈕（方框加向上箭頭）。", "往下滑，選擇「加入主畫面」。", "按右上角「加入」，桌面就會出現義學公務。"] },
  "ios-other": { title: "iPhone／iPad（Chrome、Edge 等）", steps: ["點網址列旁或選單中的「分享」按鈕。", "選擇「加入主畫面」。", "按「加入」，桌面就會出現義學公務。"], note: "若找不到「加入主畫面」，請改用 Safari 開啟本網站後再安裝。" },
  samsung: { title: "Samsung Internet", steps: ["點畫面下方的「≡」選單。", "選擇「新增頁面至」，再選「主畫面」。", "按「新增」，桌面就會出現義學公務。"] },
  android: { title: "Android（Chrome）", steps: ["點右上角「⋮」選單。", "選擇「安裝應用程式」或「加到主畫面」。", "依畫面按「安裝」，桌面就會出現義學公務。"] },
  desktop: { title: "電腦（Chrome／Edge）", steps: ["點網址列右側的「安裝」圖示。", "若沒有看到，請開啟右上角選單，選擇「安裝義學公務資訊站」或「應用程式 → 將此網站安裝為應用程式」。", "按「安裝」後，即可從桌面或開始選單開啟。"] },
  browser: { title: "其他瀏覽器", steps: ["開啟瀏覽器選單。", "尋找「安裝」或「加入主畫面」。", "若找不到，請改用 Chrome、Edge 或 Safari 開啟本網站後再安裝。"] },
};

/** LINE 內建瀏覽器無法安裝：只引導複製網址、改用 Chrome 或 Safari 開啟（不依賴自動外開）。 */
export const LINE_INSTALL_STEPS = ["點選下方「複製網址」", "開啟 Chrome／Safari，貼上網址", "依瀏覽器提示完成安裝"] as const;

/** 只保存在這個瀏覽器設定檔；github.io 網域由多個網站共用，故加上本站前綴。 */
export const INSTALL_BANNER_DISMISSED_KEY = "ysjh-info:install-banner-dismissed";

type BannerStorage = Pick<Storage, "getItem" | "setItem">;

/** 讀取失敗（無痕模式、封鎖網站資料）時視為尚未關閉，橫幅照常顯示。 */
export function readInstallBannerDismissed(storage: BannerStorage | null | undefined) {
  try { return storage?.getItem(INSTALL_BANNER_DISMISSED_KEY) === "1"; } catch { return false; }
}

/** 回傳是否保存成功；失敗時呼叫端仍會在本次瀏覽中隱藏橫幅。 */
export function writeInstallBannerDismissed(storage: BannerStorage | null | undefined) {
  try { if (!storage) return false; storage.setItem(INSTALL_BANNER_DISMISSED_KEY, "1"); return true; } catch { return false; }
}

/** 取得 localStorage；部分環境存取本身就會丟出錯誤。 */
export function browserLocalStorage(): BannerStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}
