import { readAnalyticsConsent, shouldEnableAnalytics } from "./analyticsConsent.ts";

export const ANNOUNCEMENT_OPEN_SOURCES = [
  "chasing",
  "important",
  "weekly",
  "next_week",
  "deadline",
  "latest",
  "search",
] as const;

export type AnnouncementOpenSource = (typeof ANNOUNCEMENT_OPEN_SOURCES)[number];

type AnalyticsEventParameters = Record<string, string>;

export interface AnalyticsRuntime {
  setCollectionEnabled(enabled: boolean): void;
  logEvent(name: string, parameters?: AnalyticsEventParameters): void;
}

type AnalyticsRuntimeLoader = () => Promise<AnalyticsRuntime | null>;

export function createAnalyticsController(loadRuntime: AnalyticsRuntimeLoader) {
  let runtime: AnalyticsRuntime | null = null;
  let runtimePromise: Promise<AnalyticsRuntime | null> | null = null;
  let enablePromise: Promise<boolean> | null = null;
  let desiredEnabled = false;
  let collectionEnabled = false;

  const getRuntime = () => {
    if (!runtimePromise) {
      runtimePromise = loadRuntime()
        .then(value => {
          runtime = value;
          return value;
        })
        .catch(() => null);
    }
    return runtimePromise;
  };

  const enable = () => {
    if (desiredEnabled && enablePromise) return enablePromise;

    const isReenable = Boolean(runtime) && !collectionEnabled;
    desiredEnabled = true;
    enablePromise = (async () => {
      const loadedRuntime = await getRuntime();
      if (!loadedRuntime || !desiredEnabled) return false;
      if (!collectionEnabled) {
        loadedRuntime.setCollectionEnabled(true);
        collectionEnabled = true;
        if (isReenable && typeof window !== "undefined") {
          loadedRuntime.logEvent("page_view", {
            page_location: window.location.href,
            page_title: document.title,
          });
        }
      }
      return true;
    })();
    return enablePromise;
  };

  const disable = () => {
    desiredEnabled = false;
    enablePromise = null;
    if (runtime && collectionEnabled) runtime.setCollectionEnabled(false);
    collectionEnabled = false;
  };

  const logAnnouncementOpen = (announcementId: string, source: AnnouncementOpenSource) => {
    if (!desiredEnabled || !collectionEnabled || !runtime || !announcementId) return false;
    runtime.logEvent("announcement_open", {
      announcement_id: announcementId,
      source,
    });
    return true;
  };

  return { enable, disable, logAnnouncementOpen };
}

/** 瀏覽器開啟「全球隱私控制」（GPC）時不統計。 */
export function hasGlobalPrivacyControl(navigatorLike: { globalPrivacyControl?: unknown } | undefined) {
  return navigatorLike?.globalPrivacyControl === true;
}

/**
 * 是否允許在這個瀏覽器統計：既有的退出偏好（或儲存空間被封鎖）與 GPC 一律不載入 GA4。
 * 不提供前台切換，也不改寫或清除既有偏好。
 */
export function isPublicAnalyticsAllowed() {
  if (typeof window === "undefined") return false;
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { return false; }
  return shouldEnableAnalytics(readAnalyticsConsent(storage)) && !hasGlobalPrivacyControl(navigator as { globalPrivacyControl?: unknown });
}

/** 只保留網站統計用的 Cookie；關閉廣告用儲存、廣告個人化與 Google Signals（跨裝置）。 */
export const ANALYTICS_CONSENT_DEFAULTS = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "granted",
} as const;
export const ANALYTICS_GTAG_CONFIG = {
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
} as const;

async function loadFirebaseAnalyticsRuntime(): Promise<AnalyticsRuntime | null> {
  if (typeof window === "undefined" || !process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID) return null;
  if (!isPublicAnalyticsAllowed()) return null;

  const [{ initializeAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, setConsent }, { getFirebaseApp }] = await Promise.all([
    import("firebase/analytics"),
    import("./firebaseClient.ts"),
  ]);
  if (!(await isSupported())) return null;
  if (!isPublicAnalyticsAllowed()) return null;

  // 同意設定須在初始化前套用。
  setConsent({ ...ANALYTICS_CONSENT_DEFAULTS });
  const analytics = initializeAnalytics(getFirebaseApp(), { config: { ...ANALYTICS_GTAG_CONFIG } });
  return {
    setCollectionEnabled: enabled => setAnalyticsCollectionEnabled(analytics, enabled),
    logEvent: (name, parameters) => logEvent(analytics, name, parameters),
  };
}

const publicAnalyticsController = createAnalyticsController(loadFirebaseAnalyticsRuntime);

export async function enablePublicAnalytics(): Promise<boolean> {
  return publicAnalyticsController.enable();
}

export async function trackAnnouncementOpen(
  announcementId: string,
  source: AnnouncementOpenSource,
): Promise<boolean> {
  if (!isPublicAnalyticsAllowed()) return false;
  if (!(await publicAnalyticsController.enable())) return false;
  return publicAnalyticsController.logAnnouncementOpen(announcementId, source);
}
