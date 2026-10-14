import { clearAnalyticsCookies, readAnalyticsConsent, shouldEnableAnalytics } from "./analyticsConsent.ts";

export const ANNOUNCEMENT_OPEN_SOURCES = [
  "chasing",
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

async function loadFirebaseAnalyticsRuntime(): Promise<AnalyticsRuntime | null> {
  if (typeof window === "undefined" || !process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID) return null;

  const [{ getAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled }, { getFirebaseApp }] = await Promise.all([
    import("firebase/analytics"),
    import("./firebaseClient.ts"),
  ]);
  if (!(await isSupported())) return null;
  if (!shouldEnableAnalytics(readAnalyticsConsent(window.localStorage))) return null;

  const analytics = getAnalytics(getFirebaseApp());
  return {
    setCollectionEnabled: enabled => setAnalyticsCollectionEnabled(analytics, enabled),
    logEvent: (name, parameters) => logEvent(analytics, name, parameters),
  };
}

const publicAnalyticsController = createAnalyticsController(loadFirebaseAnalyticsRuntime);

export async function enablePublicAnalytics(): Promise<boolean> {
  return publicAnalyticsController.enable();
}

export function disablePublicAnalytics(): void {
  publicAnalyticsController.disable();
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    clearAnalyticsCookies(document, window.location.hostname);
  }
}

export async function trackAnnouncementOpen(
  announcementId: string,
  source: AnnouncementOpenSource,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!shouldEnableAnalytics(readAnalyticsConsent(window.localStorage))) return false;
  if (!(await publicAnalyticsController.enable())) return false;
  return publicAnalyticsController.logAnnouncementOpen(announcementId, source);
}
