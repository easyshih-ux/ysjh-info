import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { taipeiDateKeyFromMillis } from "./retentionCleanup.js";
import { formatTaipeiDateTime, retentionCleanupLogSummary, type RetentionCleanupRunReport } from "./retentionCleanupJob.js";

/**
 * 方案 C Gate 5：自動清理執行紀錄（retentionCleanupRuns/{runId}）。
 *
 * 安全設計：
 * - 只在 runRetentionCleanup「完成之後」由排程呼叫；本模組不參與清理判斷、順序、上限或刪除。
 * - 每次執行只新增一筆紀錄，且只使用 create()（文件已存在即失敗），絕不覆蓋既有紀錄。
 * - 寫入失敗只記錄到 Cloud Logging 並回傳 failed，不拋出例外，不影響已完成的清理，也不會重新刪除。
 * - 紀錄格式沿用排程日誌摘要（retentionCleanupLogSummary），監控 callable 的 parseRunSummary 可直接讀取。
 * - 只保存公告 ID、狀態、日期與必要原因；不保存標題、內文、附件或個人資料。
 * - expiresAt＝執行開始後 90 天，供 Firestore TTL 政策自動刪除（TTL 政策需另行於正式環境設定）。
 */
export const RETENTION_CLEANUP_RUNS_COLLECTION = "retentionCleanupRuns";
export const RETENTION_RUN_RECORD_VERSION = 1;
export const RETENTION_RUN_RETENTION_DAYS = 90;
/** 同一個 runId 已存在但內容不同時，最多改用 -2 … -5 的文件 ID。 */
export const RETENTION_RUN_MAX_ID_ATTEMPTS = 5;

export type RetentionRunResult = "off" | "rejected" | "failed" | "completed" | "completedWithErrors" | "stoppedAfterFailure";

/** 穩定的 runId：由執行開始時間（UTC，毫秒）產生，與刪除器的 runId 同一時間點；冒號改為連字號以利閱讀。 */
export function retentionRunIdFromStart(startedAtIso: string) {
  return startedAtIso.replace(/:/g, "-");
}

/** 整體結果：live 只要有任一篇失敗就是 stoppedAfterFailure，不會記為成功。 */
export function retentionRunResult(report: RetentionCleanupRunReport): RetentionRunResult {
  if (report.status === "off") return "off";
  if (report.status === "rejectedLive") return "rejected";
  if (report.status === "failed") return "failed";
  if (report.status === "live" && report.liveResults.some(result => result.outcome === "failed")) return "stoppedAfterFailure";
  return report.errors.length > 0 ? "completedWithErrors" : "completed";
}

/** 同一份報告一定得到相同雜湊（不含完成時間與到期時間），用來辨識「同一次執行的重複寫入」。 */
function contentHash(summary: unknown) {
  return createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 32);
}

export function buildRetentionCleanupRunRecord(report: RetentionCleanupRunReport, finishedAtMilliseconds: number) {
  // JSON 往返：移除 undefined（Firestore 不接受），並確保只含純資料。
  const summary = JSON.parse(JSON.stringify(retentionCleanupLogSummary(report))) as ReturnType<typeof retentionCleanupLogSummary>;
  const startedMilliseconds = Date.parse(report.startedAt);
  return {
    recordVersion: RETENTION_RUN_RECORD_VERSION,
    runId: retentionRunIdFromStart(report.startedAt),
    result: retentionRunResult(report),
    ...summary,
    finishedAtUtc: new Date(finishedAtMilliseconds).toISOString(),
    contentHash: contentHash(summary),
    expiresAt: new Date(startedMilliseconds + RETENTION_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}
export type RetentionCleanupRunRecord = ReturnType<typeof buildRetentionCleanupRunRecord>;

/** 例外說明中可能出現的憑證樣式（API 金鑰、私鑰、Bearer token、長串編碼）一律遮蔽。 */
const SECRET_PATTERNS = [/-----BEGIN[\s\S]*?(-----END[^-]*-----|$)/g, /AIza[0-9A-Za-z_-]{20,}/g, /Bearer\s+[0-9A-Za-z._~+/=-]+/gi, /ya29\.[0-9A-Za-z._-]+/g, /[0-9A-Za-z+_=-]{40,}/g];

/**
 * 未預期例外的安全摘要：只保留錯誤類型與第一行訊息（最多 200 字），不含堆疊、公告內文或個資；憑證樣式遮蔽為 [redacted]。
 * 清理流程的錯誤訊息只會包含公告 ID 或文件路徑，不會包含公告內容。
 */
export function summarizeRetentionCleanupError(error: unknown) {
  const name = error instanceof Error ? error.name.slice(0, 40) : typeof error;
  const firstLine = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0] ?? "";
  const redacted = SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), firstLine);
  return `${name}: ${redacted}`.slice(0, 200);
}

export const RETENTION_CRASH_NOTE = "清理途中發生未預期例外；本次掃描、刪除、跳過與未處理數量無法確認，請查閱 Cloud Logging。";

/**
 * 清理函式直接拋出例外時的紀錄：結果為 failed；無法確認的數量一律為 null（不是 0），
 * 不含 liveCounts／liveResults，避免被誤讀為「沒有刪除任何公告」。
 */
export function buildRetentionCleanupCrashRecord(startedAtIso: string, finishedAtMilliseconds: number, error: unknown) {
  const startedMilliseconds = Date.parse(startedAtIso);
  const errorSummary = summarizeRetentionCleanupError(error);
  const summary = {
    runDate: taipeiDateKeyFromMillis(startedMilliseconds),
    startedAtTaipei: `${formatTaipeiDateTime(startedMilliseconds)} (Asia/Taipei)`,
    startedAtUtc: startedAtIso,
    status: "failed" as const,
    mode: null, requestedMode: null, maxDeletesPerRun: null,
    scanned: null, eligible: null, skipped: null, deferredCount: null,
    crashed: true as const,
    note: RETENTION_CRASH_NOTE,
    errorCount: 1,
    errors: [errorSummary],
  };
  return {
    recordVersion: RETENTION_RUN_RECORD_VERSION,
    runId: retentionRunIdFromStart(startedAtIso),
    result: "failed" as const,
    ...summary,
    finishedAtUtc: new Date(finishedAtMilliseconds).toISOString(),
    contentHash: contentHash(summary),
    expiresAt: new Date(startedMilliseconds + RETENTION_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}
export type RetentionCleanupCrashRecord = ReturnType<typeof buildRetentionCleanupCrashRecord>;
export type RetentionRunRecordDocument = RetentionCleanupRunRecord | RetentionCleanupCrashRecord;

export interface RetentionRunRecordWriter {
  /** 只能新增；文件已存在時必須拋出 already-exists 錯誤（Firestore create() 的語意）。 */
  create: (documentId: string, record: RetentionRunRecordDocument) => Promise<void>;
  read: (documentId: string) => Promise<unknown>;
}

export interface RetentionRunLogger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export type RetentionRunRecordOutcome =
  | { status: "written"; documentId: string }
  | { status: "duplicate"; documentId: string }
  | { status: "failed"; documentId: string; message: string };

export function isAlreadyExistsError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS" || /ALREADY_EXISTS/.test(error instanceof Error ? error.message : String(error));
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
export function safeLog(logger: RetentionRunLogger, level: "log" | "error", label: string, payload: unknown) {
  try { logger[level](label, JSON.stringify(payload)); } catch { /* 日誌失敗不得影響排程 */ }
}

/**
 * 寫入一筆執行紀錄。絕不拋出例外。
 * - 文件 ID 已存在且內容相同（同一次執行重複寫入）→ duplicate，不覆蓋。
 * - 已存在但內容不同（不同執行剛好同一毫秒）→ 改用 runId-2 … runId-5，仍不覆蓋。
 * - 其他錯誤 → failed，寫入 Cloud Logging（retention-cleanup-run-record-failed）。
 */
export async function recordRetentionCleanupRun(
  writer: RetentionRunRecordWriter,
  report: RetentionCleanupRunReport,
  finishedAtMilliseconds: number,
  logger: RetentionRunLogger,
): Promise<RetentionRunRecordOutcome> {
  let record: RetentionCleanupRunRecord;
  try {
    record = buildRetentionCleanupRunRecord(report, finishedAtMilliseconds);
  } catch (error) {
    const outcome = { status: "failed" as const, documentId: "", message: `build: ${messageOf(error)}` };
    safeLog(logger, "error", "retention-cleanup-run-record-failed", { startedAtUtc: report.startedAt, message: outcome.message });
    return outcome;
  }
  return writeRunRecord(writer, record, logger);
}

/** 只用 create() 寫入；重複時判斷是否為同一次執行，絕不覆蓋。絕不拋出例外。 */
async function writeRunRecord(writer: RetentionRunRecordWriter, record: RetentionRunRecordDocument, logger: RetentionRunLogger): Promise<RetentionRunRecordOutcome> {
  for (let attempt = 1; attempt <= RETENTION_RUN_MAX_ID_ATTEMPTS; attempt++) {
    const documentId = attempt === 1 ? record.runId : `${record.runId}-${attempt}`;
    try {
      await writer.create(documentId, record);
      safeLog(logger, "log", "retention-cleanup-run-recorded", { documentId, result: record.result });
      return { status: "written", documentId };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        const outcome = { status: "failed" as const, documentId, message: messageOf(error) };
        safeLog(logger, "error", "retention-cleanup-run-record-failed", { documentId, result: record.result, message: outcome.message });
        return outcome;
      }
    }
    let existing: unknown;
    try {
      existing = await writer.read(documentId);
    } catch (error) {
      const outcome = { status: "failed" as const, documentId, message: `read existing: ${messageOf(error)}` };
      safeLog(logger, "error", "retention-cleanup-run-record-failed", { documentId, result: record.result, message: outcome.message });
      return outcome;
    }
    const existingRecord = typeof existing === "object" && existing !== null ? existing as Record<string, unknown> : {};
    if (existingRecord.contentHash === record.contentHash && existingRecord.startedAtUtc === record.startedAtUtc) {
      safeLog(logger, "log", "retention-cleanup-run-record-duplicate", { documentId });
      return { status: "duplicate", documentId };
    }
  }
  const outcome = { status: "failed" as const, documentId: record.runId, message: "all candidate document IDs already exist with different content" };
  safeLog(logger, "error", "retention-cleanup-run-record-failed", { documentId: record.runId, result: record.result, message: outcome.message });
  return outcome;
}

/**
 * 清理函式直接拋出例外時呼叫：先寫入 Cloud Logging，再嘗試寫入 failed 紀錄。
 * 絕不拋出例外（呼叫端會重新拋出原始例外）；紀錄寫入失敗只留下 Logging 錯誤，不會重新清理或刪除。
 */
export async function recordRetentionCleanupCrash(
  writer: RetentionRunRecordWriter,
  startedAtMilliseconds: number,
  clock: () => number,
  error: unknown,
  logger: RetentionRunLogger,
): Promise<RetentionRunRecordOutcome> {
  try {
    const startedAtIso = new Date(startedAtMilliseconds).toISOString();
    safeLog(logger, "error", "retention-cleanup-run-crashed", { runId: retentionRunIdFromStart(startedAtIso), startedAtUtc: startedAtIso, error: summarizeRetentionCleanupError(error) });
    let finishedAt = startedAtMilliseconds;
    try { finishedAt = clock(); } catch { /* 完成時間取不到時以開始時間代替 */ }
    return await writeRunRecord(writer, buildRetentionCleanupCrashRecord(startedAtIso, finishedAt, error), logger);
  } catch (unexpected) {
    const outcome = { status: "failed" as const, documentId: "", message: `crash record: ${messageOf(unexpected)}` };
    safeLog(logger, "error", "retention-cleanup-run-record-failed", { message: outcome.message });
    return outcome;
  }
}

/** 正式 Firestore 寫入器：只使用 create()（不覆蓋）與 get()；沒有 set、update 或 delete。 */
export function createFirestoreRetentionRunWriter(firestore: Firestore): RetentionRunRecordWriter {
  const runs = firestore.collection(RETENTION_CLEANUP_RUNS_COLLECTION);
  return {
    create: async (documentId, record) => { await runs.doc(documentId).create(record); },
    read: async documentId => {
      const snapshot = await runs.doc(documentId).get();
      return snapshot.exists ? snapshot.data() : null;
    },
  };
}
