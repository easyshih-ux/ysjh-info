/**
 * Gate 4B-2：公告自動清理資格判斷（純計算，不讀寫 Firestore、不刪除任何資料）。
 *
 * 本檔不 import 任何模組，可被 Functions 與前端測試直接載入，用於前後端一致性測試。
 * 期限分類（isValidCalendarDate／isStrictIsoDateTime／lastEffectiveDateFromRaw／classifyRetentionDates）
 * 必須與 lib/retentionReview.ts 保持一致；tests/retentionCleanupParity.test.ts 會比對兩邊結果。
 *
 * 規則（Gate 4B-1 已確認）：
 * - 只有 retentionPolicy === "autoCleanup" 才可能符合資格；longTerm、缺少或不合法一律跳過。
 * - 有期限：最後有效日期（活動結束日，無結束日用開始日；與截止日取最晚）＋3 個日曆月＋14 天。
 * - 無期限（結構化日期欄位皆空）：原始發布日期（臺灣日期）＋3 個日曆月＋14 天；不解析標題或內文。
 * - 更新保護：contentUpdatedAt、updatedAt、有效補充提醒（含相關補充）中最晚的時間（臺灣日期）＋14 天。
 * - 最終清理日期＝基本清理日期與更新保護日期中較晚者；臺灣日期「當天」起才符合日期條件。
 * - 加月時目標月份沒有該日，取該月最後一天；先加月、再加天。臺灣無日光節約時間，固定 UTC+8。
 * - 任何資料不確定，一律跳過並回報原因代碼。
 */

export const RETENTION_CLEANUP_MONTHS = 3;
export const RETENTION_CLEANUP_GRACE_DAYS = 14;
export const RETENTION_UPDATE_PROTECTION_DAYS = 14;
const TAIPEI_UTC_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const isAbsent = (value: unknown) => value === undefined || value === null || value === "";

// ===== 期限分類（與 lib/retentionReview.ts 一致）=====

/** 嚴格的 YYYY-MM-DD，且必須是真實存在的日期（例如 2026-02-30 不合法）。 */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 完整、有效且可明確解讀的時間：ISO 8601 日期＋時間＋時區（Z 或 ±HH:MM）。 */
export function isStrictIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !isValidCalendarDate(match[1])) return false;
  const [hour, minute, second] = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[5] !== "Z" && (Number(match[6]) > 14 || Number(match[7]) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

export type EffectiveDateResult =
  | { kind: "dated"; lastDate: string }
  | { kind: "undated" }
  | { kind: "invalid"; reason: string };

/** 依原始資料計算最後有效日期；無法可靠判定時回傳 invalid，不自行推算。 */
export function lastEffectiveDateFromRaw(raw: unknown): EffectiveDateResult {
  if (!isRecord(raw)) return { kind: "invalid", reason: "公告資料格式異常" };
  const events = raw.importantEvents ?? [];
  const deadlines = raw.deadlines ?? [];
  if (!Array.isArray(events)) return { kind: "invalid", reason: "活動日期格式異常" };
  if (!Array.isArray(deadlines)) return { kind: "invalid", reason: "截止日期格式異常" };
  const dates: string[] = [];
  for (const event of events) {
    if (!isRecord(event) || !isValidCalendarDate(event.date)) return { kind: "invalid", reason: "活動開始日格式異常" };
    if (isAbsent(event.endDate)) { dates.push(event.date); continue; }
    if (!isValidCalendarDate(event.endDate)) return { kind: "invalid", reason: "活動結束日格式異常" };
    if (event.endDate < event.date) return { kind: "invalid", reason: "活動結束日早於開始日" };
    dates.push(event.endDate);
  }
  for (const deadline of deadlines) {
    if (!isRecord(deadline) || !isValidCalendarDate(deadline.date)) return { kind: "invalid", reason: "截止日期格式異常" };
    dates.push(deadline.date);
  }
  if (dates.length === 0) return { kind: "undated" };
  return { kind: "dated", lastDate: dates.reduce((latest, date) => date > latest ? date : latest) };
}

/** 有期限／無期限（發布日期完整有效）／日期異常；無期限但發布日期無法明確解讀者歸為 invalid。 */
export function classifyRetentionDates(raw: unknown): EffectiveDateResult {
  const effective = lastEffectiveDateFromRaw(raw);
  if (effective.kind !== "undated") return effective;
  if (!isRecord(raw) || !isStrictIsoDateTime(raw.publishedAt)) return { kind: "invalid", reason: "發布日期不完整或無法明確解讀，無法作為無期限公告的清理基準" };
  return effective;
}

// ===== 臺灣日曆日期運算（不使用會自動溢位的 Date 月份運算）=====

/** 毫秒時間 → 臺灣日曆日期 YYYY-MM-DD（臺灣固定 UTC+8）。 */
export function taipeiDateKeyFromMillis(milliseconds: number) {
  const date = new Date(milliseconds + TAIPEI_UTC_OFFSET_MILLISECONDS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 加日曆月；目標月份沒有該日時取該月最後一天（例如 11/30＋3 個月＝2/28 或 2/29）。 */
export function addCalendarMonths(dateKey: string, months: number) {
  if (!isValidCalendarDate(dateKey)) throw new Error(`Invalid calendar date: ${dateKey}`);
  const [year, month, day] = dateKey.split("-").map(Number);
  const monthIndex = (month - 1) + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

/** 加日曆天（以 UTC 日曆運算，日數溢位即為正確的跨月、跨年結果）。 */
export function addCalendarDays(dateKey: string, days: number) {
  if (!isValidCalendarDate(dateKey)) throw new Error(`Invalid calendar date: ${dateKey}`);
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** 基本清理日期：先加 3 個日曆月（月底取最後一天），再加 14 天。 */
export function baseCleanupDate(dateKey: string) {
  return addCalendarDays(addCalendarMonths(dateKey, RETENTION_CLEANUP_MONTHS), RETENTION_CLEANUP_GRACE_DAYS);
}

// ===== 時間值解析 =====

type TimeValue = { ok: true; milliseconds: number | null } | { ok: false };

/** 欄位不存在 → null；Firestore Timestamp（toMillis）或嚴格 ISO 字串 → 毫秒；其他 → 異常。 */
function readTimeValue(value: unknown): TimeValue {
  if (value === undefined || value === null) return { ok: true, milliseconds: null };
  if (typeof value === "string") return isStrictIsoDateTime(value) ? { ok: true, milliseconds: Date.parse(value) } : { ok: false };
  if (isRecord(value) && typeof value.toMillis === "function") {
    const milliseconds = (value.toMillis as () => unknown)();
    return typeof milliseconds === "number" && Number.isFinite(milliseconds) ? { ok: true, milliseconds } : { ok: false };
  }
  return { ok: false };
}

const FOLLOW_UP_TYPES = new Set(["supplement", "reminder", "related"]);

/**
 * 有效補充提醒（含相關補充）的最新時間。
 * - 只有 status 為 withdrawn 且 withdrawnAt 時間有效時，才視為已撤回並排除（與前端判定一致）；
 *   否則一律視為有效，保守納入。
 * - 納入 createdAt；相關補充修改後的 updatedAt 也一併納入（只會延後清理）。
 * - 有效補充的類型或時間異常 → 無法可靠判斷保護期限，回傳 invalid。
 */
export function latestActiveFollowUpMillis(followUps: readonly unknown[]): { ok: true; milliseconds: number | null } | { ok: false } {
  let latest: number | null = null;
  for (const item of followUps) {
    if (!isRecord(item)) return { ok: false };
    const withdrawnAt = readTimeValue(item.withdrawnAt);
    const withdrawn = item.status === "withdrawn" && withdrawnAt.ok && withdrawnAt.milliseconds !== null;
    if (withdrawn) continue;
    if (typeof item.type !== "string" || !FOLLOW_UP_TYPES.has(item.type)) return { ok: false };
    const created = readTimeValue(item.createdAt);
    const updated = readTimeValue(item.updatedAt);
    if (!created.ok || created.milliseconds === null || !updated.ok) return { ok: false };
    for (const value of [created.milliseconds, updated.milliseconds]) if (value !== null && (latest === null || value > latest)) latest = value;
  }
  return { ok: true, milliseconds: latest };
}

// ===== 清理資格判斷 =====

export const RETENTION_CLEANUP_SKIP_REASONS = {
  invalid_document: "公告資料格式異常",
  retention_long_term: "保存方式為長期保留",
  retention_unreviewed: "保存方式缺少（尚未審查）",
  retention_invalid: "保存方式不合法",
  deletion_in_progress: "公告正在永久刪除（由管理員處理）",
  invalid_schedule_dates: "活動或截止日期異常",
  invalid_published_at: "無期限公告的發布日期無效",
  invalid_update_time: "更新時間格式異常",
  collection_in_progress: "正在催繳",
  collection_status_unknown: "催繳狀態無法判斷",
  line_notice_pending: "LINE 通知仍有待處理",
  line_notice_unknown: "LINE 通知狀態無法判斷",
  line_notices_unavailable: "無法取得 LINE 通知資料",
  follow_ups_invalid: "補充提醒資料異常，無法判斷保護期限",
  follow_ups_unavailable: "無法取得補充提醒資料",
  invalid_today: "今日日期無效",
  not_yet_due: "尚未到達清理日期",
} as const;
export type RetentionCleanupSkipReason = keyof typeof RETENTION_CLEANUP_SKIP_REASONS;

export interface RetentionCleanupInput {
  id: string;
  /** Firestore 公告主文件原始資料。 */
  data: unknown;
  /** followUps 子集合原始資料；null 表示無法取得（一律跳過）。主文件舊版 followUps 陣列會另外納入。 */
  followUps: readonly unknown[] | null;
  /** lineNotices 子集合原始資料；null 表示無法取得（一律跳過）。 */
  lineNotices: readonly unknown[] | null;
  /** 判斷基準的臺灣日期 YYYY-MM-DD。 */
  today: string;
}

export interface RetentionCleanupDecision {
  id: string;
  retentionPolicy: string | null;
  category: EffectiveDateResult["kind"];
  categoryReason?: string;
  /** 有期限：最後有效日期；無期限：發布日期（臺灣日期）。 */
  basisDate: string | null;
  baseCleanupDate: string | null;
  latestUpdateDate: string | null;
  protectionDate: string | null;
  finalCleanupDate: string | null;
  eligible: boolean;
  skipReasons: RetentionCleanupSkipReason[];
}

export function evaluateRetentionCleanup(input: RetentionCleanupInput): RetentionCleanupDecision {
  const raw = input.data;
  const reasons: RetentionCleanupSkipReason[] = [];
  const decision: RetentionCleanupDecision = {
    id: input.id,
    retentionPolicy: isRecord(raw) && typeof raw.retentionPolicy === "string" ? raw.retentionPolicy : null,
    category: "invalid",
    basisDate: null, baseCleanupDate: null, latestUpdateDate: null, protectionDate: null, finalCleanupDate: null,
    eligible: false,
    skipReasons: reasons,
  };
  if (!isRecord(raw) || typeof input.id !== "string" || !input.id.trim()) {
    reasons.push("invalid_document");
    return decision;
  }

  // 保存方式
  if (raw.retentionPolicy === "longTerm") reasons.push("retention_long_term");
  else if (raw.retentionPolicy === undefined || raw.retentionPolicy === null) reasons.push("retention_unreviewed");
  else if (raw.retentionPolicy !== "autoCleanup") reasons.push("retention_invalid");

  // 永久刪除中（欄位存在即視為刪除中，與 Rules 一致）
  if ("deletionStartedAt" in raw) reasons.push("deletion_in_progress");

  // 期限分類與基本清理日期
  const category = classifyRetentionDates(raw);
  decision.category = category.kind;
  if (category.kind === "invalid") {
    decision.categoryReason = category.reason;
    reasons.push(lastEffectiveDateFromRaw(raw).kind === "undated" ? "invalid_published_at" : "invalid_schedule_dates");
  } else {
    decision.basisDate = category.kind === "dated" ? category.lastDate : taipeiDateKeyFromMillis(Date.parse(raw.publishedAt as string));
    decision.baseCleanupDate = baseCleanupDate(decision.basisDate);
  }

  // 更新保護：contentUpdatedAt、updatedAt、有效補充提醒（子集合＋舊版陣列）
  const updateTimes: number[] = [];
  let updateTimesReliable = true;
  for (const field of ["contentUpdatedAt", "updatedAt"] as const) {
    const value = readTimeValue(raw[field]);
    if (!value.ok) updateTimesReliable = false;
    else if (value.milliseconds !== null) updateTimes.push(value.milliseconds);
  }
  if (!updateTimesReliable) reasons.push("invalid_update_time");

  if (input.followUps === null) reasons.push("follow_ups_unavailable");
  else {
    const legacy = raw.followUps;
    if (legacy !== undefined && legacy !== null && !Array.isArray(legacy)) reasons.push("follow_ups_invalid");
    else {
      const latest = latestActiveFollowUpMillis([...input.followUps, ...(Array.isArray(legacy) ? legacy : [])]);
      if (!latest.ok) reasons.push("follow_ups_invalid");
      else if (latest.milliseconds !== null) updateTimes.push(latest.milliseconds);
    }
  }
  if (updateTimes.length > 0) {
    decision.latestUpdateDate = taipeiDateKeyFromMillis(Math.max(...updateTimes));
    decision.protectionDate = addCalendarDays(decision.latestUpdateDate, RETENTION_UPDATE_PROTECTION_DAYS);
  }

  // 催繳
  if (raw.collectionStatus === "chasing") reasons.push("collection_in_progress");
  else if (raw.collectionStatus !== undefined && raw.collectionStatus !== null) reasons.push("collection_status_unknown");

  // LINE 通知
  if (input.lineNotices === null) reasons.push("line_notices_unavailable");
  else {
    if (input.lineNotices.some(notice => isRecord(notice) && notice.status === "pending")) reasons.push("line_notice_pending");
    if (input.lineNotices.some(notice => !isRecord(notice) || (notice.status !== "pending" && notice.status !== "sent"))) reasons.push("line_notice_unknown");
  }

  // 最終清理日期與到期判斷
  if (decision.baseCleanupDate) {
    decision.finalCleanupDate = decision.protectionDate && decision.protectionDate > decision.baseCleanupDate ? decision.protectionDate : decision.baseCleanupDate;
  }
  if (!isValidCalendarDate(input.today)) reasons.push("invalid_today");
  else if (decision.finalCleanupDate && input.today < decision.finalCleanupDate) reasons.push("not_yet_due");

  decision.eligible = reasons.length === 0 && decision.finalCleanupDate !== null;
  return decision;
}

export function summarizeRetentionCleanup(decisions: readonly RetentionCleanupDecision[]) {
  const skippedByReason: Partial<Record<RetentionCleanupSkipReason, number>> = {};
  for (const decision of decisions) for (const reason of decision.skipReasons) skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
  return { total: decisions.length, eligible: decisions.filter(decision => decision.eligible).length, skipped: decisions.filter(decision => !decision.eligible).length, skippedByReason };
}
