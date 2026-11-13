import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { summarizeRetentionCleanup, taipeiDateKeyFromMillis } from "./retentionCleanup.js";
import { RETENTION_CLEANUP_SCHEDULE, type RetentionCleanupStatus, type RetentionRunSummary, type RetentionStatusAnnouncement } from "./retentionCleanupStatusTypes.js";
import {
  createFirestoreRetentionCleanupReader, evaluateAnnouncementsForCleanup, formatTaipeiDateTime, parseRetentionCleanupSettings,
  planRetentionDeletions, RETENTION_CLEANUP_LOG_MAX_ERRORS, type RetentionCleanupReader,
} from "./retentionCleanupJob.js";
import { RETENTION_CLEANUP_RUNS_COLLECTION } from "./retentionCleanupRunRecord.js";

/**
 * 自動清理監控（方案 C，Gate 2）：systemAdmin 專用的「唯讀」狀態查詢。
 *
 * - 只使用唯讀讀取器與 get()，沒有任何寫入、刪除或觸發排程的能力。
 * - 清理預覽與排程使用同一組判斷函式（evaluateAnnouncementsForCleanup／planRetentionDeletions），
 *   不論目前模式為 live、dryRun 或 off，都依「今天」的臺灣日期重新計算。
 * - 結果快取 5 分鐘；「立即檢查」（refresh: true）每 60 秒最多重新計算一次，避免重複讀取。
 * - 執行紀錄讀取 retentionCleanupRuns（由後續階段的排程寫入）；尚未有紀錄時回傳空陣列。
 */
const REGION = "asia-east1";
export const RETENTION_STATUS_CACHE_TTL_MILLISECONDS = 5 * 60 * 1000;
export const RETENTION_STATUS_REFRESH_INTERVAL_MILLISECONDS = 60 * 1000;
export const RETENTION_STATUS_MAX_RUNS = 30;
// 執行紀錄集合名稱與寫入端（排程）共用同一個常數。
export { RETENTION_CLEANUP_RUNS_COLLECTION } from "./retentionCleanupRunRecord.js";
// 回傳格式與排程常數定義於不依賴 firebase 套件的共用檔，前端可安全載入型別。
export { RETENTION_CLEANUP_SCHEDULE } from "./retentionCleanupStatusTypes.js";
export type { RetentionCleanupStatus, RetentionRunSummary, RetentionStatusAnnouncement } from "./retentionCleanupStatusTypes.js";

type StatusValue = Omit<RetentionCleanupStatus, "cached" | "refreshThrottled" | "nextRefreshAt">;
export interface RetentionStatusCache { entry: { value: StatusValue; computedAt: number } | null; pending: Promise<StatusValue> | null }
export const createRetentionStatusCache = (): RetentionStatusCache => ({ entry: null, pending: null });
const productionCache = createRetentionStatusCache();

export const getRetentionCleanupStatus = onCall(
  { region: REGION, minInstances: 0 },
  request => getRetentionCleanupStatusHandler(request, { cache: productionCache }),
);

export interface RetentionStatusDependencies {
  firestore?: Firestore;
  reader?: RetentionCleanupReader;
  readRuns?: () => Promise<{ id: string; data: unknown }[]>;
  cache?: RetentionStatusCache;
  now?: () => number;
}

export async function getRetentionCleanupStatusHandler(
  request: { auth?: { uid: string } | null; data: unknown },
  dependencies: RetentionStatusDependencies = {},
): Promise<RetentionCleanupStatus> {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "請先登入系統管理員帳號。");
  const refresh = parseStatusRequest(request.data);
  const firestore = dependencies.firestore ?? getFirestore();
  const caller = await firestore.collection("authorizedPublishers").doc(callerUid).get();
  const profile = caller.data();
  if (!caller.exists || profile?.enabled !== true || profile.role !== "systemAdmin") {
    throw new HttpsError("permission-denied", "只有系統管理員可以查看自動清理狀態。");
  }

  const cache = dependencies.cache ?? productionCache;
  const now = dependencies.now?.() ?? Date.now();
  const entry = cache.entry;
  const fresh = entry && now - entry.computedAt < RETENTION_STATUS_CACHE_TTL_MILLISECONDS;
  const refreshAllowed = !entry || now - entry.computedAt >= RETENTION_STATUS_REFRESH_INTERVAL_MILLISECONDS;
  const respond = (value: StatusValue, computedAt: number, cached: boolean, refreshThrottled: boolean): RetentionCleanupStatus => ({
    ...value, cached, refreshThrottled, nextRefreshAt: new Date(computedAt + RETENTION_STATUS_REFRESH_INTERVAL_MILLISECONDS).toISOString(),
  });

  if (entry && (fresh || refresh) && !(refresh && refreshAllowed)) {
    return respond(entry.value, entry.computedAt, true, refresh && !refreshAllowed);
  }
  if (cache.pending) return respond(await cache.pending, now, true, false);

  const load = computeRetentionCleanupStatus({
    reader: dependencies.reader ?? createFirestoreRetentionCleanupReader(firestore),
    readRuns: dependencies.readRuns ?? (() => readRecentRuns(firestore)),
    now,
  });
  cache.pending = load;
  try {
    const value = await load;
    cache.entry = { value, computedAt: now };
    return respond(value, now, false, false);
  } catch (error) {
    console.error("retention-status-failed", error instanceof Error ? error.message : String(error));
    throw new HttpsError("unavailable", "目前無法取得自動清理狀態，請稍後再試。");
  } finally {
    cache.pending = null;
  }
}

function parseStatusRequest(data: unknown) {
  if (data === undefined || data === null) return false;
  if (typeof data !== "object" || Array.isArray(data)) throw new HttpsError("invalid-argument", "查詢參數格式不正確。");
  const keys = Object.keys(data);
  if (keys.some(key => key !== "refresh")) throw new HttpsError("invalid-argument", "查詢參數格式不正確。");
  const refresh = (data as { refresh?: unknown }).refresh;
  if (refresh !== undefined && typeof refresh !== "boolean") throw new HttpsError("invalid-argument", "查詢參數格式不正確。");
  return refresh === true;
}

const text = (value: unknown, max = 200) => typeof value === "string" ? value.slice(0, max) : "";

export async function computeRetentionCleanupStatus(options: {
  reader: RetentionCleanupReader;
  readRuns: () => Promise<{ id: string; data: unknown }[]>;
  now: number;
}): Promise<StatusValue> {
  const { reader, readRuns, now } = options;
  const today = taipeiDateKeyFromMillis(now);
  const errors: string[] = [];
  const settings = parseRetentionCleanupSettings(await reader.readSettings());
  const announcements = await reader.listAnnouncements();
  const decisions = await evaluateAnnouncementsForCleanup(reader, announcements, today, errors);
  const summary = summarizeRetentionCleanup(decisions);
  const plan = planRetentionDeletions(decisions);
  const byId = new Map(announcements.map(item => [item.id, item.data]));
  const rows = decisions.map((decision): RetentionStatusAnnouncement => {
    const data = byId.get(decision.id);
    const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
    return {
      id: decision.id,
      title: text(record.title) || "（無標題）",
      department: text(record.department, 40),
      publicationStatus: record.publicationStatus === "withdrawn" ? "withdrawn" : "published",
      retentionPolicy: decision.retentionPolicy,
      category: decision.category,
      basisDate: decision.basisDate, baseCleanupDate: decision.baseCleanupDate, latestUpdateDate: decision.latestUpdateDate,
      protectionDate: decision.protectionDate, finalCleanupDate: decision.finalCleanupDate,
      eligible: decision.eligible,
      skipReasons: decision.skipReasons,
    };
  }).sort((a, b) => (a.finalCleanupDate ?? "9999-12-31").localeCompare(b.finalCleanupDate ?? "9999-12-31") || a.id.localeCompare(b.id));

  let runs: RetentionRunSummary[] = [];
  try {
    runs = (await readRuns()).map(parseRunSummary);
  } catch (error) {
    errors.push(`runs: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    generatedAtTaipei: `${formatTaipeiDateTime(now)} (Asia/Taipei)`,
    today,
    settings: { mode: settings.mode, requestedMode: typeof settings.requestedMode === "string" ? settings.requestedMode.slice(0, 40) : settings.requestedMode === undefined ? "(missing)" : `(${typeof settings.requestedMode})`, maxDeletesPerRun: settings.maxDeletesPerRun },
    schedule: RETENTION_CLEANUP_SCHEDULE,
    summary: {
      scanned: summary.total, eligible: summary.eligible, skipped: summary.skipped, skippedByReason: summary.skippedByReason,
      wouldDeleteToday: plan.slice(0, settings.maxDeletesPerRun).map(item => item.id), deferredCount: Math.max(0, plan.length - settings.maxDeletesPerRun),
    },
    announcements: rows,
    runs,
    errors: errors.slice(0, RETENTION_CLEANUP_LOG_MAX_ERRORS).map(message => message.slice(0, 200)),
  };
}

async function readRecentRuns(firestore: Firestore) {
  const snapshot = await firestore.collection(RETENTION_CLEANUP_RUNS_COLLECTION).orderBy("startedAtUtc", "desc").limit(RETENTION_STATUS_MAX_RUNS).get();
  return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
}

const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown, max = 80) => typeof value === "string" ? value.slice(0, max) : null;

/** 執行紀錄格式與排程日誌摘要（retentionCleanupLogSummary）相同；欄位缺漏時以 null 表示。 */
export function parseRunSummary({ id, data }: { id: string; data: unknown }): RetentionRunSummary {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const liveCounts = typeof record.liveCounts === "object" && record.liveCounts !== null ? record.liveCounts as Record<string, unknown> : {};
  const liveResults = Array.isArray(record.liveResults) ? record.liveResults : [];
  return {
    id,
    runDate: stringOrNull(record.runDate, 10),
    startedAt: stringOrNull(record.startedAtUtc, 40),
    startedAtTaipei: stringOrNull(record.startedAtTaipei, 40),
    status: stringOrNull(record.status, 20),
    mode: stringOrNull(record.mode, 20),
    result: stringOrNull(record.result, 30),
    scanned: numberOrNull(record.scanned),
    eligible: numberOrNull(record.eligible),
    skipped: numberOrNull(record.skipped),
    deleted: numberOrNull(liveCounts.deleted) ?? (record.status === "live" ? 0 : null),
    failed: numberOrNull(liveCounts.failed) ?? (record.status === "live" ? 0 : null),
    errorCount: numberOrNull(record.errorCount),
    results: liveResults.slice(0, 50).flatMap(item => {
      if (typeof item !== "object" || item === null) return [];
      const result = item as Record<string, unknown>;
      const detail = Array.isArray(result.reasons) ? result.reasons.map(String).join("、") : stringOrNull(result.stage, 20) ?? undefined;
      return typeof result.id === "string" && typeof result.outcome === "string" ? [{ id: result.id.slice(0, 80), outcome: result.outcome.slice(0, 30), ...(detail ? { detail: detail.slice(0, 200) } : {}) }] : [];
    }),
  };
}
