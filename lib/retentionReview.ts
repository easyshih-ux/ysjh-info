/**
 * Gate 3B／4A-2：舊公告保存方式集中審查（純邏輯，不連線 Firebase）。
 *
 * - 只處理「尚未審查」：Firestore 原始資料沒有合法 retentionPolicy。
 * - 期限判斷直接檢查原始資料，任何一筆日期格式異常即整篇判定為異常，不得設定自動清理。
 *   （讀取顯示用的 announcementFromFirestore 會略過異常日期，不能用來判斷期限。）
 * - 最後有效日期只取活動結束日（無結束日才用開始日）與截止日，不以發布、修改、補充或 LINE 日期替代。
 * - 三類：有明確期限／無明確期限（結構化日期欄位為空，且發布日期完整有效）／日期異常。
 *   無明確期限公告未來以發布日期計算；發布日期不完整或無法明確解讀者歸為日期異常。
 *   標題或內文中的日期不會被辨識。
 * - 本模組不執行任何刪除。
 */
import { announcementFromFirestore } from "./announcementFirestore.ts";
import { isRetentionPolicy, type RetentionPolicy } from "./announcementRetention.ts";
import type { Announcement } from "./announcements.ts";
import { isDepartment } from "./departments.ts";

export const RETENTION_REVIEW_PAGE_SIZE = 50;
export const RETENTION_REVIEW_CHUNK_SIZE = 50;

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);

/** 嚴格的 YYYY-MM-DD，且必須是真實存在的日期（例如 2026-02-30 不合法）。 */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type EffectiveDateResult =
  | { kind: "dated"; lastDate: string }
  | { kind: "undated" }
  | { kind: "invalid"; reason: string };

const isAbsent = (value: unknown) => value === undefined || value === null || value === "";

/** 依 Firestore 原始資料計算最後有效日期；無法可靠判定時回傳 invalid，不自行推算。 */
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

/**
 * 完整、有效且可明確解讀的發布時間：ISO 8601 日期＋時間＋時區（Z 或 ±HH:MM），
 * 各欄位須在合法範圍且為真實存在的日期。僅 Date.parse 可解析（例如 "2026"、"Nov 6 2026"）不算通過。
 */
export function isStrictIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !isValidCalendarDate(match[1])) return false;
  const [hour, minute, second] = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[5] !== "Z" && (Number(match[6]) > 14 || Number(match[7]) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * 審查與寫入共用的期限分類：
 * - 有任何日期異常 → invalid（不推算、不改用發布日期）。
 * - 有有效日期 → dated。
 * - 結構化日期欄位為空：發布日期完整有效 → undated；否則 invalid（無法作為清理基準）。
 */
export function classifyRetentionDates(raw: unknown): EffectiveDateResult {
  const effective = lastEffectiveDateFromRaw(raw);
  if (effective.kind !== "undated") return effective;
  if (!isRecord(raw) || !isStrictIsoDateTime(raw.publishedAt)) return { kind: "invalid", reason: "發布日期不完整或無法明確解讀，無法作為無期限公告的清理基準" };
  return effective;
}

export function hasExplicitDeadline(effective: EffectiveDateResult): effective is { kind: "dated"; lastDate: string } {
  return effective.kind === "dated";
}

/** 可設定自動清理：有明確期限，或無明確期限但發布日期有效（classifyRetentionDates 已處理）。 */
export function allowsAutoCleanup(effective: EffectiveDateResult) {
  return effective.kind !== "invalid";
}

export function isUnreviewedRaw(raw: unknown) {
  return !isRecord(raw) || !isRetentionPolicy(raw.retentionPolicy);
}

/** 與 Firestore Rules 的 'deletionStartedAt' in resource.data 一致：欄位存在即視為刪除中。 */
export function isDeletingRaw(raw: unknown) {
  return isRecord(raw) && "deletionStartedAt" in raw;
}

export interface RetentionReviewItem {
  id: string;
  title: string;
  department: Announcement["department"];
  academicYear: number;
  publishedAt: string;
  publicationStatus: "published" | "withdrawn";
  effective: EffectiveDateResult;
}

export interface UnlistableReviewEntry {
  id: string;
  /** 原始標題（若為可顯示的字串）。 */
  title?: string;
  reasons: string[];
}

export interface RetentionReviewData {
  /** 讀到的公告文件總數；恆等於 items.length + unlistableCount + reviewedCount + deletingCount。 */
  totalCount: number;
  items: RetentionReviewItem[];
  /** 尚未審查、未刪除，但資料格式異常而無法列出的公告數。這些公告維持尚未審查。 */
  unlistableCount: number;
  /** 無法列出的公告與原因，讓管理員能找到並交由維護者修正（長度恆等於 unlistableCount）。 */
  unlistable: UnlistableReviewEntry[];
  deletingCount: number;
  reviewedCount: number;
}

/** 說明公告為何無法被讀取流程（announcementFromFirestore）列出；檢查項目與其必要欄位一致。 */
export function describeUnlistableReasons(id: string, raw: unknown): string[] {
  if (!isRecord(raw)) return ["公告資料格式異常"];
  const reasons: string[] = [];
  if (!id.trim()) reasons.push("公告 ID 異常");
  if (!Number.isInteger(raw.academicYear)) reasons.push("學年度缺少或格式異常");
  if (typeof raw.publishedAt !== "string" || !raw.publishedAt.trim() || Number.isNaN(Date.parse(raw.publishedAt))) reasons.push("發布日期缺少或格式異常");
  if (!isDepartment(raw.department)) reasons.push("發布單位缺少或格式異常");
  if (typeof raw.title !== "string" || !raw.title.trim()) reasons.push("標題缺少");
  if (typeof raw.content !== "string") reasons.push("內容欄位格式異常");
  return reasons.length > 0 ? reasons : ["資料格式異常"];
}

export function buildRetentionReviewData(documents: readonly { id: string; data: unknown }[]): RetentionReviewData {
  // 每篇文件只會落入一個分類：刪除中 → 已審查 → 尚未審查（可列出／格式異常）。
  const result: RetentionReviewData = { totalCount: documents.length, items: [], unlistableCount: 0, unlistable: [], deletingCount: 0, reviewedCount: 0 };
  for (const { id, data } of documents) {
    if (isDeletingRaw(data)) { result.deletingCount++; continue; }
    if (!isUnreviewedRaw(data)) { result.reviewedCount++; continue; }
    const announcement = announcementFromFirestore(id, data);
    if (!announcement) {
      result.unlistableCount++;
      const title = isRecord(data) && typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 120) : undefined;
      result.unlistable.push({ id, ...(title ? { title } : {}), reasons: describeUnlistableReasons(id, data) });
      continue;
    }
    result.items.push({
      id,
      title: announcement.title,
      department: announcement.department,
      academicYear: announcement.academicYear,
      publishedAt: announcement.publishedAt,
      publicationStatus: announcement.publicationStatus === "withdrawn" ? "withdrawn" : "published",
      effective: classifyRetentionDates(data),
    });
  }
  result.items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return result;
}

export type DeadlineFilter = "all" | "dated" | "undated" | "invalid";
export interface RetentionReviewFilters {
  deadline: DeadlineFilter;
  department: string;
  academicYear: "all" | number;
  query: string;
}
export const DEFAULT_RETENTION_REVIEW_FILTERS: RetentionReviewFilters = { deadline: "all", department: "all", academicYear: "all", query: "" };

export function filterRetentionReviewItems(items: readonly RetentionReviewItem[], filters: RetentionReviewFilters) {
  const needle = filters.query.trim().toLocaleLowerCase("zh-Hant");
  return items
    .filter(item => filters.deadline === "all" || item.effective.kind === filters.deadline)
    .filter(item => filters.department === "all" || item.department === filters.department)
    .filter(item => filters.academicYear === "all" || item.academicYear === filters.academicYear)
    .filter(item => !needle || item.title.toLocaleLowerCase("zh-Hant").includes(needle))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** 學年度選項由實際資料產生（新到舊），不固定只有目前學年。 */
export function academicYearOptions(items: readonly RetentionReviewItem[]) {
  return [...new Set(items.map(item => item.academicYear))].sort((a, b) => b - a);
}

export function departmentOptions(items: readonly RetentionReviewItem[]) {
  return [...new Set(items.map(item => item.department))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

export function paginate<T>(items: readonly T[], page: number, pageSize = RETENTION_REVIEW_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { page: current, pageCount, pageItems: items.slice((current - 1) * pageSize, current * pageSize) };
}

export interface SelectionSummary { total: number; dated: number; undated: number; invalid: number }

export function summarizeSelection(items: readonly RetentionReviewItem[]): SelectionSummary {
  const count = (kind: EffectiveDateResult["kind"]) => items.filter(item => item.effective.kind === kind).length;
  return { total: items.length, dated: count("dated"), undated: count("undated"), invalid: count("invalid") };
}

/** 選取中只要有任何日期異常的公告，整次自動清理都不可送出；無明確期限公告可以設定。 */
export function autoCleanupBlockReason(summary: SelectionSummary): string | null {
  if (summary.total === 0) return "尚未選取公告。";
  if (summary.invalid > 0) return `選取中有 ${summary.invalid} 篇日期異常的公告，不能設定「依公告期限自動清理」。請取消選取這些公告並先確認日期資料，或改設「長期保留」。`;
  return null;
}

export function canSubmitRetentionBatch(policy: RetentionPolicy, summary: SelectionSummary) {
  if (summary.total === 0) return false;
  return policy === "longTerm" || autoCleanupBlockReason(summary) === null;
}

export type RetentionSkipReason = "missing" | "alreadyReviewed" | "deleting" | "invalidDate";
export type RetentionFailReason = "notAdmin" | "writeFailed" | "signedOut" | "serviceUnavailable" | "notProcessed";

export const RETENTION_SKIP_REASON_LABELS: Record<RetentionSkipReason, string> = {
  missing: "公告已不存在",
  alreadyReviewed: "已有保存方式，未覆蓋",
  deleting: "公告正在永久刪除",
  invalidDate: "日期異常，不可設定自動清理",
};
export const RETENTION_FAIL_REASON_LABELS: Record<RetentionFailReason, string> = {
  notAdmin: "目前帳號不是啟用中的系統管理員",
  writeFailed: "這篇公告無法寫入（可能有其他欄位格式異常），請稍後重試或聯絡系統維護者",
  signedOut: "登入狀態失效或無法確認管理員身分，已停止處理",
  serviceUnavailable: "網路或服務暫時無法使用，已停止處理",
  notProcessed: "因前述問題停止，尚未處理",
};

/** 操作者身分無法讀取（登入失效、權限被拒）時拋出，整個批次立即停止。 */
export class RetentionOperatorCheckError extends Error {
  readonly original: unknown;
  constructor(original: unknown) {
    super("operator check failed");
    this.name = "RetentionOperatorCheckError";
    this.original = original;
  }
}

/**
 * 交易失敗分類：
 * - splittable：與特定公告有關（例如某篇舊資料無法通過 Rules、資料競爭重試用盡），可逐篇重試隔離。
 * - signedOut：登入失效或無法確認操作者身分 → 停止，不再嘗試。
 * - serviceUnavailable：網路或服務問題（含無法辨識的錯誤）→ 停止，不再嘗試。
 */
export function classifyRetentionTransactionError(error: unknown): "splittable" | "signedOut" | "serviceUnavailable" {
  if (error instanceof RetentionOperatorCheckError) return "signedOut";
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code).replace(/^firestore\//, "") : "";
  if (code === "unauthenticated") return "signedOut";
  if (code === "permission-denied" || code === "aborted" || code === "failed-precondition" || code === "invalid-argument" || code === "not-found" || code === "already-exists" || code === "out-of-range") return "splittable";
  // unavailable、deadline-exceeded、resource-exhausted、cancelled、internal、unknown 等網路／服務錯誤，
  // 以及無法辨識的錯誤，一律保守停止，不逐篇重試。
  return "serviceUnavailable";
}

/**
 * 依序處理各批：
 * - 批次成功：採用交易內逐篇判斷的結果。
 * - 可拆分的失敗：整批未寫入，改逐篇各自交易重試，只有真正失敗者列為 writeFailed。
 * - 登入或服務問題：立即停止；本批與後續批次全部列為失敗（可重試），不做無意義的連續重試。
 */
export async function processRetentionChunks(
  chunks: readonly (readonly string[])[],
  runChunk: (ids: readonly string[]) => Promise<RetentionBatchOutcome[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<RetentionBatchOutcome[]> {
  const total = chunks.reduce((count, chunk) => count + chunk.length, 0);
  const outcomes: RetentionBatchOutcome[] = [];
  let stopReason: "signedOut" | "serviceUnavailable" | null = null;
  const stopAt = (ids: readonly string[], reason: "signedOut" | "serviceUnavailable") => { stopReason = reason; for (const id of ids) outcomes.push({ id, status: "failed", reason }); };
  let lostAdmin = false;
  for (const chunk of chunks) {
    if (lostAdmin) { for (const id of chunk) outcomes.push({ id, status: "failed", reason: "notAdmin" }); continue; }
    if (stopReason) { for (const id of chunk) outcomes.push({ id, status: "failed", reason: "notProcessed" }); continue; }
    try {
      const chunkOutcomes = await runChunk(chunk);
      outcomes.push(...chunkOutcomes);
      // 已不是啟用中的 systemAdmin：後續批次不再嘗試。
      if (chunkOutcomes.some(outcome => outcome.status === "failed" && outcome.reason === "notAdmin")) lostAdmin = true;
    } catch (error) {
      const kind = classifyRetentionTransactionError(error);
      if (kind !== "splittable") { stopAt(chunk, kind); continue; }
      for (const [index, id] of chunk.entries()) {
        if (lostAdmin) { outcomes.push({ id, status: "failed", reason: "notAdmin" }); continue; }
        if (stopReason) { outcomes.push({ id, status: "failed", reason: "notProcessed" }); continue; }
        try {
          const itemOutcomes = await runChunk([id]);
          outcomes.push(...itemOutcomes);
          if (itemOutcomes.some(outcome => outcome.status === "failed" && outcome.reason === "notAdmin")) lostAdmin = true;
        } catch (itemError) {
          const itemKind = classifyRetentionTransactionError(itemError);
          if (itemKind === "splittable") outcomes.push({ id, status: "failed", reason: "writeFailed" });
          else stopAt(chunk.slice(index, index + 1), itemKind);
        }
      }
    }
    onProgress?.(outcomes.length, total);
  }
  return outcomes;
}

/** 批次是否因登入或服務問題提前停止（用於結果畫面的提示）。 */
export function retentionBatchStopped(outcomes: readonly RetentionBatchOutcome[]) {
  return outcomes.some(outcome => outcome.status === "failed" && (outcome.reason === "signedOut" || outcome.reason === "serviceUnavailable"));
}

/** 交易中重新讀取後的判斷；只有通過才允許寫入 retentionPolicy。 */
export function evaluateRetentionWrite(exists: boolean, raw: unknown, policy: RetentionPolicy): { ok: true } | { ok: false; reason: RetentionSkipReason } {
  if (!exists || !isRecord(raw)) return { ok: false, reason: "missing" };
  if (isDeletingRaw(raw)) return { ok: false, reason: "deleting" };
  if (!isUnreviewedRaw(raw)) return { ok: false, reason: "alreadyReviewed" };
  // 與審查清單使用同一個分類：日期異常（含無期限但發布日期無法明確解讀）不得設定自動清理。
  if (policy === "autoCleanup" && !allowsAutoCleanup(classifyRetentionDates(raw))) return { ok: false, reason: "invalidDate" };
  return { ok: true };
}

export function isEnabledSystemAdminProfile(raw: unknown) {
  return isRecord(raw) && raw.enabled === true && raw.role === "systemAdmin";
}

export type RetentionBatchOutcome =
  | { id: string; status: "success" }
  | { id: string; status: "skipped"; reason: RetentionSkipReason }
  | { id: string; status: "failed"; reason: RetentionFailReason };

export function chunkIds(ids: readonly string[], size = RETENTION_REVIEW_CHUNK_SIZE) {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) chunks.push(unique.slice(index, index + size));
  return chunks;
}

export interface RetentionBatchSummary {
  success: number;
  skipped: number;
  failed: number;
  skippedByReason: Partial<Record<RetentionSkipReason, number>>;
  failedByReason: Partial<Record<RetentionFailReason, number>>;
  /** 可安全重試的失敗項目（重試時會在交易中重新確認狀態與權限）。 */
  retryableIds: string[];
  /** 因登入或網路／服務問題提前停止。 */
  stopped: boolean;
}

export function summarizeRetentionOutcomes(outcomes: readonly RetentionBatchOutcome[]): RetentionBatchSummary {
  const summary: RetentionBatchSummary = { success: 0, skipped: 0, failed: 0, skippedByReason: {}, failedByReason: {}, retryableIds: [], stopped: retentionBatchStopped(outcomes) };
  for (const outcome of outcomes) {
    if (outcome.status === "success") summary.success++;
    else if (outcome.status === "skipped") { summary.skipped++; summary.skippedByReason[outcome.reason] = (summary.skippedByReason[outcome.reason] ?? 0) + 1; }
    else {
      summary.failed++;
      summary.failedByReason[outcome.reason] = (summary.failedByReason[outcome.reason] ?? 0) + 1;
      // 權限不足重試也不會成功；需先恢復 systemAdmin 權限，故不列入可重試。
      if (outcome.reason !== "notAdmin") summary.retryableIds.push(outcome.id);
    }
  }
  return summary;
}

export function formatReviewDate(value: string) {
  return value.replaceAll("-", "/");
}
