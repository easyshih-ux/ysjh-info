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
 * 正式刪除的程式碼層級開關。⚠️ 維持 false：即使設定被改為 live，排程也只會回報 rejectedLive，
 * 不建立刪除器、不掃描、不刪除。正式啟用須另行授權，修改此常數為 true 並重新部署此函式。
 */
export const RETENTION_CLEANUP_LIVE_ALLOWED = false;

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
