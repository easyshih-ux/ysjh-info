import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defaultAnnouncementCleanup } from "./announcementDeletion.js";
import { createFirestoreRetentionCleanupReader, retentionCleanupLogSummary, runRetentionCleanup, type RetentionCleanupReader } from "./retentionCleanupJob.js";
import { createRetentionDeleter, type RetentionDeleter } from "./retentionCleanupLive.js";
import { createFirestoreRetentionRunWriter, recordRetentionCleanupCrash, recordRetentionCleanupRun, type RetentionRunLogger, type RetentionRunRecordWriter } from "./retentionCleanupRunRecord.js";

/**
 * Gate 4B-3A／4B-3B-2／4B-4：每日自動清理排程（第二代 Scheduled Function）。
 *
 * 由 index.ts 匯出；部署時請只部署此函式：
 *   npx firebase deploy --only functions:retentionCleanupDaily --project ysjh-public-affairs
 *
 * - 每天臺灣時間 03:00，地區 asia-east1，不自動重試（避免同日重複觸發）。
 * - 實際行為由 systemSettings/retentionCleanup 的 mode 決定：預設（缺少設定）為 off。
 * - dry-run 只讀取資料並把摘要寫入 Cloud Logging，不寫入或刪除任何公告、補充提醒、LINE 待辦或附件。
 * - Gate 5：每次執行「完成後」新增一筆 retentionCleanupRuns 執行紀錄（off、dryRun、live 皆會記錄）。
 *   紀錄寫入失敗只寫入 Cloud Logging，不影響已完成的清理，也不會重新刪除。
 * - Gate 6A-1：清理函式直接拋出未預期例外時，寫入 Cloud Logging 與 result: failed 的紀錄（無法確認的數量為 null），
 *   再重新拋出原始例外，讓平台標示本次排程失敗（retryCount 0，不會自動重跑）。
 * - 需要 firebase-admin 已初始化（index.ts 會呼叫 initializeApp）；firestore 於執行時才取得。
 */

/**
 * 正式刪除的程式碼層級開關。Gate 4C（2026-11-13）經管理員授權改為 true。
 * 仍需 systemSettings/retentionCleanup 的 mode 為 live 才會刪除；mode 為 dryRun 或 off 時不刪除。
 * 緊急停用：把設定 mode 改為 dryRun 或 off（不需重新部署）；必要時再將此常數改回 false 並重新部署。
 */
export const RETENTION_CLEANUP_LIVE_ALLOWED = true;

export interface ScheduledRetentionCleanupDependencies {
  reader: RetentionCleanupReader;
  /** 執行開始時間（毫秒）；也是刪除器與執行紀錄 runId 的時間點。 */
  now: number;
  deleter?: RetentionDeleter;
  writer: RetentionRunRecordWriter;
  logger: RetentionRunLogger;
  /** 取得完成時間（毫秒）。 */
  clock: () => number;
}

/**
 * 排程的完整流程：清理 → Cloud Logging 摘要 → 執行紀錄。
 * 清理邏輯完全沿用 runRetentionCleanup；執行紀錄在清理結束後才寫入，且寫入結果不影響清理報告。
 */
export async function runScheduledRetentionCleanup(dependencies: ScheduledRetentionCleanupDependencies) {
  const { reader, now, deleter, writer, logger, clock } = dependencies;
  let report: Awaited<ReturnType<typeof runRetentionCleanup>>;
  try {
    report = await runRetentionCleanup(reader, now, { allowLive: RETENTION_CLEANUP_LIVE_ALLOWED, deleter });
  } catch (error) {
    // 只記錄、不重試：已刪除的公告不會被重新處理；紀錄寫入失敗也不會掩蓋原始例外。
    await recordRetentionCleanupCrash(writer, now, clock, error, logger);
    throw error;
  }
  logger.log("retention-cleanup-run", JSON.stringify(retentionCleanupLogSummary(report)));
  const record = await recordRetentionCleanupRun(writer, report, clock(), logger);
  return { report, record };
}

export const retentionCleanupDaily = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Asia/Taipei", region: "asia-east1", retryCount: 0 },
  async () => {
    const firestore = getFirestore();
    const now = Date.now();
    const deleter = RETENTION_CLEANUP_LIVE_ALLOWED
      ? createRetentionDeleter(firestore, { runId: new Date(now).toISOString(), cleanup: defaultAnnouncementCleanup(firestore) })
      : undefined;
    await runScheduledRetentionCleanup({
      reader: createFirestoreRetentionCleanupReader(firestore), now, deleter,
      writer: createFirestoreRetentionRunWriter(firestore), logger: console, clock: Date.now,
    });
  },
);
