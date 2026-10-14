export const ANALYTICS_CONSENT_STORAGE_KEY = "ysjh.analytics-consent.v1";

export type AnalyticsConsent = "granted" | "denied";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
type CookieDocument = Pick<Document, "cookie">;

export function readAnalyticsConsent(storage: StorageReader): AnalyticsConsent | null {
  try {
    const value = storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return "denied";
  }
}

export function shouldEnableAnalytics(consent: AnalyticsConsent | null): boolean {
  return consent !== "denied";
}

export function writeAnalyticsConsent(storage: StorageWriter, consent: AnalyticsConsent): boolean {
  try {
    storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, consent);
    return true;
  } catch {
    return false;
  }
}

export function analyticsCookieNames(cookieHeader: string): string[] {
  const analyticsCookiePattern = /^(?:_ga(?:_.+)?|_gid|_gat(?:_.+)?)$/;
  return cookieHeader
    .split(";")
    .map(cookie => cookie.trim().split("=")[0])
    .filter((name): name is string => Boolean(name) && analyticsCookiePattern.test(name));
}

export function clearAnalyticsCookies(
  cookieDocument: CookieDocument,
  hostname: string,
  basePath = "/ysjh-info",
): void {
  const names = analyticsCookieNames(cookieDocument.cookie);
  if (names.length === 0) return;

  const paths = Array.from(new Set(["/", basePath, `${basePath}/`]));
  const domains = Array.from(new Set(["", hostname, `.${hostname}`]));

  for (const name of names) {
    for (const path of paths) {
      for (const domain of domains) {
        const domainAttribute = domain ? `; Domain=${domain}` : "";
        cookieDocument.cookie = `${name}=; Max-Age=0; Path=${path}${domainAttribute}; SameSite=Lax`;
      }
    }
  }
}
