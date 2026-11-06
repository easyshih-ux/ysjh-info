import { collection, doc, getDocs, runTransaction, type Firestore } from "firebase/firestore";
import type { RetentionPolicy } from "./announcementRetention.ts";
import { ANNOUNCEMENTS_COLLECTION, AUTHORIZED_PUBLISHERS_COLLECTION } from "./firestoreClient.ts";
import { buildRetentionReviewData, chunkIds, evaluateRetentionWrite, isEnabledSystemAdminProfile, processRetentionChunks, RETENTION_REVIEW_CHUNK_SIZE, RetentionOperatorCheckError, type RetentionBatchOutcome } from "./retentionReview.ts";

/** 沿用既有公告集合讀取（與管理頁相同），不建立新集合或索引。 */
export async function readRetentionReviewData(database: Firestore) {
  const snapshot = await getDocs(collection(database, ANNOUNCEMENTS_COLLECTION));
  return buildRetentionReviewData(snapshot.docs.map(document => ({ id: document.id, data: document.data() })));
}

/**
 * 以交易逐批（預設 50 筆）設定保存方式：
 * 交易內先讀取操作者資料與每篇公告（全部讀完才寫入），再只對仍符合條件者寫入 retentionPolicy。
 * - 操作者必須仍是啟用中的 systemAdmin；否則整批記為失敗、不寫入。
 * - 公告不存在、刪除中、已有保存方式（不覆蓋）、或自動清理但無有效日期 → 略過並回報原因。
 * - 失敗處理見 processRetentionChunks：只有與特定公告有關的失敗才逐篇重試；
 *   登入或網路／服務問題立即停止，不做無意義的連續重試。
 * Firestore Rules 仍是實際的寫入權限檢查；此處檢查不取代 Rules。
 */
export async function applyRetentionPolicyBatch(
  database: Firestore,
  operatorUid: string,
  ids: readonly string[],
  policy: RetentionPolicy,
  options: { chunkSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<RetentionBatchOutcome[]> {
  if (policy !== "autoCleanup" && policy !== "longTerm") throw new Error("Invalid retention policy");
  const chunks = chunkIds(ids, options.chunkSize ?? RETENTION_REVIEW_CHUNK_SIZE);
  return processRetentionChunks(chunks, chunk => runRetentionTransaction(database, operatorUid, chunk, policy), options.onProgress);
}

async function runRetentionTransaction(database: Firestore, operatorUid: string, ids: readonly string[], policy: RetentionPolicy) {
  return runTransaction(database, async transaction => {
    // 交易可能因資料競爭而重跑；結果每次都在這裡重新計算。
    let profile;
    try {
      profile = await transaction.get(doc(database, AUTHORIZED_PUBLISHERS_COLLECTION, operatorUid));
    } catch (error) {
      // 無法讀取自己的管理員資料（登入失效、權限被拒）→ 停止整個批次，不逐篇重試。
      throw new RetentionOperatorCheckError(error);
    }
    if (!isEnabledSystemAdminProfile(profile.exists() ? profile.data() : null)) {
      return ids.map((id): RetentionBatchOutcome => ({ id, status: "failed", reason: "notAdmin" }));
    }
    const references = ids.map(id => doc(database, ANNOUNCEMENTS_COLLECTION, id));
    const snapshots = await Promise.all(references.map(reference => transaction.get(reference)));
    return snapshots.map((snapshot, index): RetentionBatchOutcome => {
      const verdict = evaluateRetentionWrite(snapshot.exists(), snapshot.exists() ? snapshot.data() : null, policy);
      if (!verdict.ok) return { id: ids[index], status: "skipped", reason: verdict.reason };
      transaction.update(references[index], { retentionPolicy: policy });
      return { id: ids[index], status: "success" };
    });
  });
}
