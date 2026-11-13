import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defaultAnnouncementCleanup } from "./announcementDeletion.js";
import { createFirestoreRetentionCleanupReader, retentionCleanupLogSummary, runRetentionCleanup } from "./retentionCleanupJob.js";
import { createRetentionDeleter } from "./retentionCleanupLive.js";

/**
 * Gate 4B-3A／4B-3B-2／4B-4：每日自動清理排程（第二代 Scheduled Function）。
 *
 * 由 index.ts 匯出；部署時請只部署此函式：
 *   npx firebase deploy --only functions:retentionCleanupDaily --project ysjh-public-affairs
 *
 * - 每天臺灣時間 03:00，地區 asia-east1，不自動重試（避免同日重複觸發）。
 * - 實際行為由 systemSettings/retentionCleanup 的 mode 決定：預設（缺少設定）為 off。
 * - dry-run 只讀取資料並把摘要寫入 Cloud Logging，不寫入或刪除任何 Firestore／Storage 資料。
 * - 需要 firebase-admin 已初始化（index.ts 會呼叫 initializeApp）；firestore 於執行時才取得。
 */

/**
 * 正式刪除的程式碼層級開關。Gate 4C（2026-11-13）經管理員授權改為 true。
 * 仍需 systemSettings/retentionCleanup 的 mode 為 live 才會刪除；mode 為 dryRun 或 off 時不刪除。
 * 緊急停用：把設定 mode 改為 dryRun 或 off（不需重新部署）；必要時再將此常數改回 false 並重新部署。
 */
export const RETENTION_CLEANUP_LIVE_ALLOWED = true;

export const retentionCleanupDaily = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Asia/Taipei", region: "asia-east1", retryCount: 0 },
  async () => {
    const firestore = getFirestore();
    const now = Date.now();
    const deleter = RETENTION_CLEANUP_LIVE_ALLOWED
      ? createRetentionDeleter(firestore, { runId: new Date(now).toISOString(), cleanup: defaultAnnouncementCleanup(firestore) })
      : undefined;
    const report = await runRetentionCleanup(createFirestoreRetentionCleanupReader(firestore), now, { allowLive: RETENTION_CLEANUP_LIVE_ALLOWED, deleter });
    console.log("retention-cleanup-run", JSON.stringify(retentionCleanupLogSummary(report)));
  },
);
