import type { Firestore } from "firebase-admin/firestore";
import { evaluateRetentionCleanup, summarizeRetentionCleanup, taipeiDateKeyFromMillis, type RetentionCleanupDecision, type RetentionCleanupInput } from "./retentionCleanup.js";

/**
 * Gate 4B-3A：自動清理排程的執行邏輯（目前只支援 off 與 dryRun）。
 *
 * 安全設計：
 * - 只接收唯讀的 RetentionCleanupReader；本模組沒有任何刪除或寫入的相依物件，dry-run 在結構上無法刪除。
 * - 模式來自 systemSettings/retentionCleanup；缺少或不合法一律視為 off。
 * - live 在本階段一律拒絕：不掃描、不判斷、不刪除，只回報 rejectedLive。
 * - 單篇補充提醒或 LINE 通知讀取失敗 → 以 null 傳入判斷，該篇跳過（unavailable），不中斷其他公告。
 * - 報告只回傳給呼叫端（目前僅寫入 Cloud Logging）；本階段不寫入任何 Firestore 資料。
 */
export const RETENTION_CLEANUP_SETTINGS_COLLECTION = "systemSettings";
export const RETENTION_CLEANUP_SETTINGS_DOC = "retentionCleanup";
export const RETENTION_CLEANUP_MAX_PER_RUN = 20;

export type RetentionCleanupMode = "off" | "dryRun" | "live";

export interface RetentionCleanupSettings {
  mode: RetentionCleanupMode;
  /** 原始設定值（用於報告；不合法時 mode 已降為 off）。 */
  requestedMode: unknown;
  maxDeletesPerRun: number;
}

export function parseRetentionCleanupSettings(raw: unknown): RetentionCleanupSettings {
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const requestedMode = record.mode;
  const mode: RetentionCleanupMode = requestedMode === "dryRun" || requestedMode === "live" ? requestedMode : "off";
  const max = record.maxDeletesPerRun;
  const maxDeletesPerRun = typeof max === "number" && Number.isInteger(max) && max >= 1 ? Math.min(max, RETENTION_CLEANUP_MAX_PER_RUN) : RETENTION_CLEANUP_MAX_PER_RUN;
  return { mode, requestedMode, maxDeletesPerRun };
}

export interface RetentionCleanupReader {
  readSettings: () => Promise<unknown>;
  listAnnouncements: () => Promise<{ id: string; data: unknown }[]>;
  readFollowUps: (announcementId: string) => Promise<unknown[]>;
  readLineNotices: (announcementId: string) => Promise<unknown[]>;
}

/** 預計清理公告的判斷依據（只含 ID 與日期，不含標題、內容或個人資料）。 */
export interface RetentionCleanupPlanItem {
  id: string;
  finalCleanupDate: string;
  category: RetentionCleanupDecision["category"];
  basisDate: string | null;
  baseCleanupDate: string | null;
  latestUpdateDate: string | null;
  protectionDate: string | null;
}

export interface RetentionCleanupRunReport {
  today: string;
  startedAt: string;
  status: "off" | "dryRun" | "rejectedLive" | "failed";
  mode: RetentionCleanupMode;
  requestedMode: unknown;
  maxDeletesPerRun: number;
  scanned: number;
  eligible: number;
  /** 若為正式模式，今天會處理的公告（依最終清理日期由早到晚，最多 maxDeletesPerRun 篇）。dry-run 不會刪除。 */
  wouldDeleteToday: RetentionCleanupPlanItem[];
  /** 已符合資格但超過單次上限，留待之後的執行。 */
  deferred: RetentionCleanupPlanItem[];
  skippedByReason: Partial<Record<string, number>>;
  decisions: RetentionCleanupDecision[];
  errors: string[];
}

const needsSubcollections = (data: unknown) => typeof data === "object" && data !== null && !Array.isArray(data)
  && (data as Record<string, unknown>).retentionPolicy === "autoCleanup" && !("deletionStartedAt" in data);

async function readOrNull(read: () => Promise<unknown[]>, errors: string[], label: string) {
  try {
    const value = await read();
    return Array.isArray(value) ? value : null;
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function runRetentionCleanup(reader: RetentionCleanupReader, nowMilliseconds: number): Promise<RetentionCleanupRunReport> {
  const today = taipeiDateKeyFromMillis(nowMilliseconds);
  const report: RetentionCleanupRunReport = {
    today, startedAt: new Date(nowMilliseconds).toISOString(), status: "off", mode: "off", requestedMode: undefined,
    maxDeletesPerRun: RETENTION_CLEANUP_MAX_PER_RUN, scanned: 0, eligible: 0, wouldDeleteToday: [], deferred: [], skippedByReason: {}, decisions: [], errors: [],
  };

  let settings: RetentionCleanupSettings;
  try {
    settings = parseRetentionCleanupSettings(await reader.readSettings());
  } catch (error) {
    // 讀不到設定：保守視為 off，不掃描。
    report.errors.push(`settings: ${error instanceof Error ? error.message : String(error)}`);
    return report;
  }
  Object.assign(report, { mode: settings.mode, requestedMode: settings.requestedMode, maxDeletesPerRun: settings.maxDeletesPerRun });

  if (settings.mode === "off") return report;
  if (settings.mode === "live") {
    // Gate 4B-3A：正式刪除尚未授權，live 一律拒絕，不掃描也不刪除。
    report.status = "rejectedLive";
    report.errors.push("live mode is not enabled in this version; no announcements were scanned or deleted");
    return report;
  }

  report.status = "dryRun";
  let announcements: { id: string; data: unknown }[];
  try {
    announcements = await reader.listAnnouncements();
  } catch (error) {
    report.status = "failed";
    report.errors.push(`announcements: ${error instanceof Error ? error.message : String(error)}`);
    return report;
  }

  for (const { id, data } of announcements) {
    // 非 autoCleanup 或刪除中的公告一定會被跳過，不必讀取子集合（以空陣列傳入不影響跳過結果）。
    const shouldRead = needsSubcollections(data);
    const input: RetentionCleanupInput = {
      id, data, today,
      followUps: shouldRead ? await readOrNull(() => reader.readFollowUps(id), report.errors, `followUps/${id}`) : [],
      lineNotices: shouldRead ? await readOrNull(() => reader.readLineNotices(id), report.errors, `lineNotices/${id}`) : [],
    };
    report.decisions.push(evaluateRetentionCleanup(input));
  }

  const summary = summarizeRetentionCleanup(report.decisions);
  report.scanned = summary.total;
  report.eligible = summary.eligible;
  report.skippedByReason = summary.skippedByReason;
  const plan = report.decisions
    .filter(decision => decision.eligible && decision.finalCleanupDate)
    .map((decision): RetentionCleanupPlanItem => ({
      id: decision.id, finalCleanupDate: decision.finalCleanupDate as string, category: decision.category,
      basisDate: decision.basisDate, baseCleanupDate: decision.baseCleanupDate, latestUpdateDate: decision.latestUpdateDate, protectionDate: decision.protectionDate,
    }))
    .sort((a, b) => a.finalCleanupDate.localeCompare(b.finalCleanupDate) || a.id.localeCompare(b.id));
  report.wouldDeleteToday = plan.slice(0, settings.maxDeletesPerRun);
  report.deferred = plan.slice(settings.maxDeletesPerRun);
  return report;
}

/** 正式 Firestore 的唯讀讀取器：只使用 get()，不寫入、不刪除。 */
export function createFirestoreRetentionCleanupReader(firestore: Firestore): RetentionCleanupReader {
  const announcements = firestore.collection("announcements");
  return {
    readSettings: async () => {
      const snapshot = await firestore.collection(RETENTION_CLEANUP_SETTINGS_COLLECTION).doc(RETENTION_CLEANUP_SETTINGS_DOC).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    listAnnouncements: async () => (await announcements.get()).docs.map(document => ({ id: document.id, data: document.data() })),
    readFollowUps: async id => (await announcements.doc(id).collection("followUps").get()).docs.map(document => document.data()),
    readLineNotices: async id => (await announcements.doc(id).collection("lineNotices").get()).docs.map(document => document.data()),
  };
}

export const RETENTION_CLEANUP_LOG_MAX_ERRORS = 20;
const LOG_ERROR_MAX_LENGTH = 200;

/** 臺灣時間 YYYY-MM-DD HH:mm:ss（臺灣固定 UTC+8）。 */
export function formatTaipeiDateTime(milliseconds: number) {
  return new Date(milliseconds + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/** 設定中的原始 mode 只記錄安全的簡短字串，避免把任意物件寫入日誌。 */
function describeRequestedMode(value: unknown) {
  if (value === undefined || value === null) return "(missing)";
  return typeof value === "string" ? value.slice(0, 40) : `(${typeof value})`;
}

/**
 * 寫入 Cloud Logging 的摘要（供 dry-run 期間人工驗收）。
 * 只包含日期、篇數、公告 ID 與判斷依據；不含公告標題、內容、附件、個人資料或任何憑證。
 */
export function retentionCleanupLogSummary(report: RetentionCleanupRunReport) {
  const startedMilliseconds = Date.parse(report.startedAt);
  return {
    runDate: report.today,
    startedAtTaipei: `${formatTaipeiDateTime(startedMilliseconds)} (Asia/Taipei)`,
    startedAtUtc: report.startedAt,
    status: report.status,
    mode: report.mode,
    requestedMode: describeRequestedMode(report.requestedMode),
    scanned: report.scanned,
    eligible: report.eligible,
    skipped: report.scanned - report.eligible,
    maxDeletesPerRun: report.maxDeletesPerRun,
    wouldDeleteToday: report.wouldDeleteToday,
    deferredCount: report.deferred.length,
    skippedByReason: report.skippedByReason,
    errorCount: report.errors.length,
    errors: report.errors.slice(0, RETENTION_CLEANUP_LOG_MAX_ERRORS).map(message => message.slice(0, LOG_ERROR_MAX_LENGTH)),
  };
}

/**
 * 未來正式刪除前的重新驗證（純函式；本階段不會被任何刪除流程呼叫）。
 *
 * 預定的「標記 → 驗證 → 刪除或撤銷標記」流程（Gate 4B-3B 之後另行授權實作）：
 * 1. 在同一個 Admin SDK 交易中讀取公告主文件、followUps 與 lineNotices（交易可讀取查詢），
 *    以最新資料重新判斷；仍符合資格才寫入 deletionStartedAt（並下架）。不符合則不寫入任何資料。
 * 2. 標記後，Firestore Rules 會拒絕前端修改公告、新增補充提醒（含相關補充）與任何 LINE 待辦
 *    （由 tests/firestoreRules.emulator.mjs 的 L8、R9 驗證）。因此標記後再讀一次子集合即為穩定狀態。
 * 3. 標記後再次重新判斷：若交易讀取到提交之間有新的補充或 LINE 待辦（不能假設查詢一定鎖住新增文件），
 *    就撤銷本次標記（恢復原本的上下架狀態並移除 deletionStartedAt），並記錄為 race_detected；
 *    仍符合才呼叫 permanentlyDeleteAnnouncement 進行刪除。
 * 4. 已有 deletionStartedAt（人工刪除進行中或中斷）的公告一律跳過，交由管理員處理。
 */
export function revalidateBeforeDeletion(scanned: RetentionCleanupDecision, fresh: RetentionCleanupInput) {
  const decision = evaluateRetentionCleanup(fresh);
  const newReasons = decision.skipReasons.filter(reason => !scanned.skipReasons.includes(reason));
  const changed = [
    ...newReasons,
    ...(scanned.finalCleanupDate !== decision.finalCleanupDate ? ["final_cleanup_date_changed"] : []),
  ];
  return { proceed: scanned.eligible && decision.eligible && scanned.id === decision.id, decision, changed };
}
