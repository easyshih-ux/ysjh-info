import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp } from "./firebaseClient.ts";
import { RETENTION_CLEANUP_SKIP_REASONS } from "../functions/src/retentionCleanup.ts";
import type { RetentionCleanupStatus, RetentionRunSummary, RetentionStatusAnnouncement } from "../functions/src/retentionCleanupStatusTypes.ts";

export type { RetentionCleanupStatus, RetentionRunSummary, RetentionStatusAnnouncement };

/**
 * 自動清理監控（方案 C）：前端資料層。
 * 只呼叫 systemAdmin 專用的唯讀 callable getRetentionCleanupStatus；不會觸發排程、刪除或修改任何資料。
 * 跳過原因的中文說明直接沿用後端判斷模組，確保前後端一致。
 */
export async function fetchRetentionCleanupStatus(refresh = false): Promise<RetentionCleanupStatus> {
  const callable = httpsCallable<{ refresh?: boolean }, RetentionCleanupStatus>(getFunctions(getFirebaseApp(), "asia-east1"), "getRetentionCleanupStatus");
  const result = await callable(refresh ? { refresh: true } : {});
  return result.data;
}

export type RetentionRowState = "eligible" | "notYetDue" | "dueButProtected" | "longTerm" | "blocked";

export const RETENTION_ROW_STATE_LABELS: Record<RetentionRowState, string> = {
  eligible: "符合清理資格",
  notYetDue: "尚未到期",
  dueButProtected: "已到期但受保護",
  longTerm: "長期保留",
  blocked: "日期異常或其他安全阻擋",
};

/** 資料異常、狀態不明或尚未審查：屬於安全阻擋，不是單純「受保護」。 */
const BLOCKING_REASONS = new Set([
  "invalid_document", "retention_unreviewed", "retention_invalid", "invalid_schedule_dates", "invalid_published_at", "invalid_update_time",
  "collection_status_unknown", "line_notice_unknown", "line_notices_unavailable", "follow_ups_invalid", "follow_ups_unavailable", "invalid_today",
]);

/**
 * 狀態判斷（順序固定）：符合資格 → 長期保留 → 資料異常／狀態不明 → 尚未到期 → 已到期但受保護。
 * 「已到期但受保護」（催繳中、LINE 待處理、刪除進行中）不會被歸為可清理。
 */
export function classifyRetentionRow(row: Pick<RetentionStatusAnnouncement, "eligible" | "retentionPolicy" | "category" | "skipReasons">): RetentionRowState {
  if (row.eligible) return "eligible";
  if (row.retentionPolicy === "longTerm") return "longTerm";
  if (row.category === "invalid" || row.skipReasons.some(reason => BLOCKING_REASONS.has(reason))) return "blocked";
  if (row.skipReasons.includes("not_yet_due")) return "notYetDue";
  return "dueButProtected";
}

/** 跳過原因的中文說明（沿用後端）；「尚未到期」另以狀態呈現，不重複列為保護原因。 */
export function retentionReasonLabels(row: Pick<RetentionStatusAnnouncement, "skipReasons">) {
  return row.skipReasons
    .filter(reason => reason !== "not_yet_due" && reason !== "retention_long_term")
    .map(reason => (RETENTION_CLEANUP_SKIP_REASONS as Record<string, string>)[reason] ?? reason);
}

export type RetentionPreviewFilter = "within60" | "all";
export const RETENTION_PREVIEW_PAGE_SIZE = 50;

export function daysBetween(fromDateKey: string, toDateKey: string) {
  const parse = (key: string) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((parse(toDateKey) - parse(fromDateKey)) / 86_400_000);
}

/**
 * 「60 天內到期」：最終清理日期在今天起 60 天內（含已到期者）；沒有清理日期（日期異常）的公告也列入，避免被忽略。
 * 長期保留的公告不會被清理，不列入「60 天內到期」。
 */
export function filterRetentionRows(rows: readonly RetentionStatusAnnouncement[], filter: RetentionPreviewFilter, today: string) {
  const sorted = [...rows].sort((a, b) => (a.finalCleanupDate ?? "9999-12-31").localeCompare(b.finalCleanupDate ?? "9999-12-31") || a.id.localeCompare(b.id));
  if (filter === "all") return sorted;
  return sorted.filter(row => {
    const state = classifyRetentionRow(row);
    if (state === "longTerm") return false;
    if (state === "blocked" && !row.finalCleanupDate) return true;
    return row.finalCleanupDate !== null && daysBetween(today, row.finalCleanupDate) <= 60;
  });
}

export function countRowStates(rows: readonly RetentionStatusAnnouncement[]) {
  const counts: Record<RetentionRowState, number> = { eligible: 0, notYetDue: 0, dueButProtected: 0, longTerm: 0, blocked: 0 };
  for (const row of rows) counts[classifyRetentionRow(row)]++;
  return counts;
}

export function paginateRows<T>(rows: readonly T[], page: number, pageSize = RETENTION_PREVIEW_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { page: current, pageCount, pageRows: rows.slice((current - 1) * pageSize, current * pageSize) };
}

export const RETENTION_MODE_INFO: Record<RetentionCleanupStatus["settings"]["mode"], { label: string; description: string }> = {
  live: { label: "已啟用自動永久刪除", description: "每天依規則永久刪除到期公告及其補充提醒、LINE 待辦與附件。" },
  dryRun: { label: "僅模擬檢查", description: "每天只產生清理報告，不會刪除任何公告。" },
  off: { label: "停止自動清理", description: "排程不檢查、也不刪除任何公告。" },
};

/** ISO 時間 → 臺灣時間 YYYY/MM/DD HH:mm（臺灣固定 UTC+8）。 */
export function formatTaipeiDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const milliseconds = Date.parse(iso);
  if (Number.isNaN(milliseconds)) return "—";
  return new Date(milliseconds + 8 * 3_600_000).toISOString().slice(0, 16).replace("T", " ").replaceAll("-", "/");
}

export function formatDateKey(key: string | null | undefined) {
  return key ? key.replaceAll("-", "/") : "—";
}

export const RETENTION_RUN_OUTCOME_LABELS: Record<string, string> = {
  deleted: "已刪除",
  skipped_at_claim: "處理時重新判斷後跳過",
  race_unclaimed: "處理期間資料變動，已還原",
  failed: "失敗（交由管理員處理）",
};

/** 執行結果（Gate 5 紀錄的 result）中文化；只翻譯，不修改原始值。 */
export const RETENTION_RUN_RESULT_LABELS: Record<string, string> = {
  completed: "正常完成",
  completedWithErrors: "完成但有異常",
  stoppedAfterFailure: "發生錯誤，已停止",
  off: "清理已停用",
  rejected: "執行遭拒絕",
  failed: "執行失敗",
};
export type RetentionRunResultTone = "ok" | "warning" | "error" | "neutral" | "unknown";
const RESULT_TONES: Record<string, RetentionRunResultTone> = {
  completed: "ok", completedWithErrors: "warning", stoppedAfterFailure: "error", off: "neutral", rejected: "warning", failed: "error",
};
export const RETENTION_RUN_RESULT_UNKNOWN_LABEL = "狀態待確認";

/** 缺少或未知的 result 一律顯示「狀態待確認」，不推定為成功。 */
export function retentionRunResultInfo(result: string | null | undefined): { label: string; tone: RetentionRunResultTone; known: boolean } {
  if (typeof result === "string" && Object.hasOwn(RETENTION_RUN_RESULT_LABELS, result)) return { label: RETENTION_RUN_RESULT_LABELS[result], tone: RESULT_TONES[result], known: true };
  return { label: RETENTION_RUN_RESULT_UNKNOWN_LABEL, tone: "unknown", known: false };
}

/** 排程時間：每天臺灣時間 03:00（臺灣固定 UTC+8）。 */
export const RETENTION_SCHEDULE_HOUR_TAIPEI = 3;
/** 寫入緩衝：03:00 執行後到 05:00 前都不提醒（涵蓋排程延遲、冷啟動與清理處理時間）。 */
export const RETENTION_RUN_RECORD_GRACE_MILLISECONDS = 2 * 3_600_000;
/** 排程可能提早幾秒觸發，紀錄時間稍早於 03:00 仍視為該次執行。 */
export const RETENTION_RUN_EARLY_TOLERANCE_MILLISECONDS = 10 * 60_000;
const DAY = 86_400_000;
const TAIPEI_OFFSET = 8 * 3_600_000;

/**
 * 「此刻應該已經有紀錄」的最近一次排程時間（UTC 毫秒）。
 * 今天 03:00 的紀錄要到今天 05:00 之後才要求；在那之前只要求昨天 03:00 的紀錄。
 */
export function latestExpectedRunSlot(nowMilliseconds: number) {
  const taipeiDayStart = Math.floor((nowMilliseconds + TAIPEI_OFFSET) / DAY) * DAY - TAIPEI_OFFSET;
  const todaySlot = taipeiDayStart + RETENTION_SCHEDULE_HOUR_TAIPEI * 3_600_000;
  return nowMilliseconds >= todaySlot + RETENTION_RUN_RECORD_GRACE_MILLISECONDS ? todaySlot : todaySlot - DAY;
}

export type RetentionRunHistoryHealth =
  | { kind: "notStarted" }
  | { kind: "current"; latestStartedAt: string }
  | { kind: "overdue"; latestStartedAt: string; expectedSlot: string }
  | { kind: "unreadable" };

/**
 * 歷史紀錄延遲提醒（只提醒，不宣稱清理失敗）：
 * - 沒有任何紀錄 → notStarted（尚未部署或尚未執行第一次；不提醒）。
 *   沒有可靠的「開始記錄時間」資料來源，因此不硬編碼日期，而以「是否已有任何紀錄」作為開始累積的依據。
 * - 任何結果（含 off、失敗）都代表排程有執行；只看最新一筆的開始時間。
 * - 最新紀錄早於「應有紀錄的最近一次 03:00」（扣除提早容許）→ overdue。
 * - 有紀錄但時間都無法判讀 → unreadable。
 * now 使用 callable 回傳的伺服器時間（generatedAt），不依賴使用者裝置時鐘。
 */
export function assessRetentionRunHistory(runs: readonly Pick<RetentionRunSummary, "startedAt">[], nowIso: string): RetentionRunHistoryHealth {
  if (runs.length === 0) return { kind: "notStarted" };
  const times = runs.map(run => (run.startedAt ? Date.parse(run.startedAt) : Number.NaN)).filter(value => Number.isFinite(value));
  if (times.length === 0) return { kind: "unreadable" };
  const latest = Math.max(...times);
  const latestStartedAt = new Date(latest).toISOString();
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return { kind: "current", latestStartedAt };
  const slot = latestExpectedRunSlot(now);
  return latest < slot - RETENTION_RUN_EARLY_TOLERANCE_MILLISECONDS ? { kind: "overdue", latestStartedAt, expectedSlot: new Date(slot).toISOString() } : { kind: "current", latestStartedAt };
}
