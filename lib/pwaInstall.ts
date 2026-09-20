import { isLineWebView } from "./browserEnvironment.ts";

export function isStandaloneDisplay(displayModeStandalone: boolean, navigatorStandalone?: boolean) {
  return displayModeStandalone || navigatorStandalone === true;
}

export function isSafariBrowser(userAgent: string) {
  return /Safari\//i.test(userAgent)
    && !/(?:Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)\//i.test(userAgent)
    && !isLineWebView(userAgent);
}

export type InstallGuidance = "line" | "safari" | "browser";

export function getInstallGuidance(userAgent: string): InstallGuidance {
  if (isLineWebView(userAgent)) return "line";
  if (isSafariBrowser(userAgent)) return "safari";
  return "browser";
}
