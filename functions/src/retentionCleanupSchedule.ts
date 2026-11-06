import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createFirestoreRetentionCleanupReader, retentionCleanupLogSummary, runRetentionCleanup } from "./retentionCleanupJob.js";

/**
 * Gate 4B-3A：每日自動清理排程（第二代 Scheduled Function）。
 *
 * ⚠️ 本檔「刻意未」從 index.ts 匯出，因此不會被 firebase deploy 部署，也不會建立 Cloud Scheduler 工作。
 *    啟用前需另行授權，在 index.ts 加上 `export { retentionCleanupDaily } from "./retentionCleanupSchedule.js";`。
 *
 * - 每天臺灣時間 03:00，地區 asia-east1，不自動重試（避免同日重複觸發）。
 * - 實際行為由 systemSettings/retentionCleanup 的 mode 決定：預設（缺少設定）為 off。
 * - 本版本只支援 off 與 dryRun；live 一律拒絕。dry-run 只讀取資料並把摘要寫入 Cloud Logging，
 *   不寫入或刪除任何 Firestore／Storage 資料。
 * - 需要 firebase-admin 已初始化（index.ts 會呼叫 initializeApp）；firestore 於執行時才取得。
 */
export const retentionCleanupDaily = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Asia/Taipei", region: "asia-east1", retryCount: 0 },
  async () => {
    const report = await runRetentionCleanup(createFirestoreRetentionCleanupReader(getFirestore()), Date.now());
    console.log("retention-cleanup-run", JSON.stringify(retentionCleanupLogSummary(report)));
  },
);
