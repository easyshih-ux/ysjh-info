import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const REGION = "asia-east1";
const TIME_ZONE = "Asia/Taipei";
const PROPERTY_ID = "558955552";
const REPORTING_SERVICE_ACCOUNT = "ysjh-ga4-reporting@ysjh-public-affairs.iam.gserviceaccount.com";
const CACHE_TTL_MILLISECONDS = 5 * 60 * 1000;

interface ReportValue {
  value?: string | null;
}

interface ReportRow {
  dimensionValues?: ReportValue[] | null;
  metricValues?: ReportValue[] | null;
}

interface ReportResponse {
  rows?: ReportRow[] | null;
}

export interface RunReportRequest {
  property: string;
  dateRanges: Array<{ startDate: string; endDate: string }>;
  dimensions?: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  dimensionFilter?: {
    filter: {
      fieldName: string;
      stringFilter: {
        matchType: "EXACT";
        value: string;
        caseSensitive: boolean;
      };
    };
  };
  orderBys?: Array<{ dimension: { dimensionName: string }; desc: boolean }>;
}

export type RunReport = (request: RunReportRequest) => Promise<ReportResponse>;

export interface DailyUsageStatistics {
  date: string;
  activeUsers: number;
  screenPageViews: number;
}

export interface AdminUsageStatistics {
  today: {
    activeUsers: number;
    screenPageViews: number;
  };
  last7Days: {
    activeUsers: number;
    announcementOpens: number;
  };
  trend: DailyUsageStatistics[];
  dateRange: {
    startDate: string;
    endDate: string;
    timeZone: typeof TIME_ZONE;
  };
  updatedAt: string;
  cacheTtlSeconds: 300;
  cached: boolean;
  delayNotice: string;
}

interface CachedStatistics {
  expiresAt: number;
  value: Omit<AdminUsageStatistics, "cached">;
}

export interface UsageStatisticsCache {
  entry: CachedStatistics | null;
  pending: Promise<Omit<AdminUsageStatistics, "cached">> | null;
}

interface HandlerDependencies {
  firestore?: Firestore;
  runReport?: RunReport;
  cache?: UsageStatisticsCache;
  now?: () => Date;
}

const productionCache = createUsageStatisticsCache();
let analyticsClient: BetaAnalyticsDataClient | null = null;

export const getAdminUsageStatistics = onCall(
  {
    region: REGION,
    minInstances: 0,
    serviceAccount: REPORTING_SERVICE_ACCOUNT,
  },
  request => getAdminUsageStatisticsHandler(request, { cache: productionCache }),
);

export async function getAdminUsageStatisticsHandler(
  request: { auth?: { uid: string } | null; data: unknown },
  dependencies: HandlerDependencies = {},
): Promise<AdminUsageStatistics> {
  const callerUid = requireCallerUid(request.auth?.uid);
  const firestore = dependencies.firestore ?? getFirestore();
  const caller = await firestore.collection("authorizedPublishers").doc(callerUid).get();
  assertSystemAdmin(caller.exists, caller.data());
  assertEmptyRequest(request.data);

  const cache = dependencies.cache ?? productionCache;
  const now = dependencies.now?.() ?? new Date();
  const nowMilliseconds = now.getTime();
  if (cache.entry && cache.entry.expiresAt > nowMilliseconds) {
    return { ...cache.entry.value, cached: true };
  }
  if (cache.pending) {
    return { ...await cache.pending, cached: true };
  }

  const load = queryGa4UsageStatistics(dependencies.runReport ?? runProductionReport, now);
  cache.pending = load;
  try {
    const value = await load;
    cache.entry = { value, expiresAt: nowMilliseconds + CACHE_TTL_MILLISECONDS };
    return { ...value, cached: false };
  } catch (error) {
    logger.error("GA4 admin statistics query failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    throw new HttpsError("unavailable", "目前無法取得網站使用統計，請稍後再試。");
  } finally {
    cache.pending = null;
  }
}

export async function queryGa4UsageStatistics(
  runReport: RunReport,
  now: Date,
): Promise<Omit<AdminUsageStatistics, "cached">> {
  const dates = getTaipeiDateRange(now);
  const property = `properties/${PROPERTY_ID}`;
  const dateRanges = [{ startDate: dates.startDate, endDate: dates.endDate }];
  const todayDateRange = [{ startDate: dates.endDate, endDate: dates.endDate }];

  const [today, sevenDayVisitors, announcementOpens, trend] = await Promise.all([
    runReport({
      property,
      dateRanges: todayDateRange,
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
    }),
    runReport({
      property,
      dateRanges,
      metrics: [{ name: "activeUsers" }],
    }),
    runReport({
      property,
      dateRanges,
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          stringFilter: {
            matchType: "EXACT",
            value: "announcement_open",
            caseSensitive: true,
          },
        },
      },
    }),
    runReport({
      property,
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
    }),
  ]);

  return {
    today: {
      activeUsers: readMetric(today, 0),
      screenPageViews: readMetric(today, 1),
    },
    last7Days: {
      activeUsers: readMetric(sevenDayVisitors, 0),
      announcementOpens: readMetric(announcementOpens, 0),
    },
    trend: normalizeTrend(trend, dates.days),
    dateRange: {
      startDate: dates.startDate,
      endDate: dates.endDate,
      timeZone: TIME_ZONE,
    },
    updatedAt: now.toISOString(),
    cacheTtlSeconds: 300,
    delayNotice: "GA4 彙總資料可能因處理延遲而與即時使用情況略有差異。",
  };
}

export function createUsageStatisticsCache(): UsageStatisticsCache {
  return { entry: null, pending: null };
}

export function getTaipeiDateRange(now: Date) {
  if (Number.isNaN(now.getTime())) throw new Error("invalid-date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
  const taipeiDateUtc = Date.UTC(part("year"), part("month") - 1, part("day"));
  const days = Array.from({ length: 7 }, (_, index) => (
    new Date(taipeiDateUtc - (6 - index) * 86_400_000).toISOString().slice(0, 10)
  ));
  return { startDate: days[0], endDate: days[6], days };
}

async function runProductionReport(request: RunReportRequest): Promise<ReportResponse> {
  analyticsClient ??= new BetaAnalyticsDataClient();
  const [response] = await analyticsClient.runReport(request);
  return response;
}

function normalizeTrend(response: ReportResponse, expectedDates: string[]): DailyUsageStatistics[] {
  const rowsByDate = new Map<string, DailyUsageStatistics>();
  for (const row of response.rows ?? []) {
    const date = normalizeGaDate(row.dimensionValues?.[0]?.value);
    if (!date || !expectedDates.includes(date)) continue;
    rowsByDate.set(date, {
      date,
      activeUsers: parseMetric(row.metricValues?.[0]?.value),
      screenPageViews: parseMetric(row.metricValues?.[1]?.value),
    });
  }
  return expectedDates.map(date => rowsByDate.get(date) ?? {
    date,
    activeUsers: 0,
    screenPageViews: 0,
  });
}

function readMetric(response: ReportResponse, index: number) {
  return parseMetric(response.rows?.[0]?.metricValues?.[index]?.value);
}

function parseMetric(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function normalizeGaDate(value: string | null | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function requireCallerUid(uid: string | undefined) {
  if (!uid) throw new HttpsError("unauthenticated", "請先登入系統管理員帳號。");
  return uid;
}

function assertEmptyRequest(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 0) {
    throw new HttpsError("invalid-argument", "統計查詢不接受額外參數。");
  }
}

function assertSystemAdmin(exists: boolean, data: FirebaseFirestore.DocumentData | undefined) {
  if (!exists || data?.enabled !== true || data.role !== "systemAdmin") {
    throw new HttpsError("permission-denied", "只有系統管理員可以查看網站使用統計。");
  }
}
