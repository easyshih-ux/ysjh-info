import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { AnnouncementDeletionCleanupError, permanentlyDeleteAnnouncement, type AnnouncementDeletionCleanup } from "./announcementDeletion.js";
import { evaluateRetentionCleanup, type RetentionCleanupDecision } from "./retentionCleanup.js";

/**
 * Gate 4B-4：自動清理的正式刪除流程（本機開發；是否啟用由 retentionCleanupSchedule.ts 的
 * RETENTION_CLEANUP_LIVE_ALLOWED 與設定 mode 共同決定，兩者都允許才會執行）。
 *
 * 每篇公告依序：
 * 1. 標記（交易）：同一交易讀取公告主文件、followUps、lineNotices，以最新資料重新判斷；
 *    仍符合資格才下架並寫入 deletionStartedAt／deletionStartedBy（本次執行專屬的識別字串）。
 *    已有 deletionStartedAt（人工刪除進行中或中斷）→ 判斷結果為跳過，不寫入任何資料。
 * 2. 驗證：標記後 Firestore Rules 會拒絕前端修改公告、新增補充提醒與 LINE 待辦；
 *    再讀一次子集合並以標記前的主文件內容重新判斷，捕捉交易讀取到提交之間新增的資料。
 * 3. 不再符合 → 撤銷標記（恢復原本的上下架狀態，移除本次寫入的欄位）；
 *    仍符合 → 呼叫共用的 permanentlyDeleteAnnouncement，並在其交易中確認標記仍屬於本次執行。
 * 清理中途失敗：公告保留為已下架＋刪除標記，交由管理員以「永久刪除」完成（排程不再介入）。
 */
export const RETENTION_CLEANUP_ACTOR_PREFIX = "system:retention-cleanup";

export type RetentionDeletionOutcome =
  | { id: string; outcome: "deleted"; finalCleanupDate: string | null }
  | { id: string; outcome: "skipped_at_claim"; reasons: string[] }
  | { id: string; outcome: "race_unclaimed"; reasons: string[] }
  | { id: string; outcome: "failed"; stage: "claim" | "verify" | "unclaim" | "delete"; message: string };

export interface RetentionDeleter {
  deleteIfStillEligible: (announcementId: string, today: string) => Promise<RetentionDeletionOutcome>;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

export function retentionCleanupActor(runId: string) {
  return `${RETENTION_CLEANUP_ACTOR_PREFIX}:${runId}`;
}

export function createRetentionDeleter(firestore: Firestore, options: {
  runId: string;
  cleanup: AnnouncementDeletionCleanup;
  /** 僅供測試：在標記後、驗證前執行，用來模擬競爭條件。 */
  afterClaim?: (announcementId: string) => Promise<void>;
}): RetentionDeleter {
  const actor = retentionCleanupActor(options.runId);

  return {
    async deleteIfStillEligible(announcementId, today) {
      const announcementRef = firestore.collection("announcements").doc(announcementId);
      const readSubcollection = async (name: string) => (await announcementRef.collection(name).get()).docs.map(document => document.data());

      // 1. 標記
      let claim: { data: DocumentData; decision: RetentionCleanupDecision } | { skipped: string[] };
      try {
        claim = await firestore.runTransaction(async transaction => {
          const [snapshot, followUps, lineNotices] = await Promise.all([
            transaction.get(announcementRef),
            transaction.get(announcementRef.collection("followUps")),
            transaction.get(announcementRef.collection("lineNotices")),
          ]);
          if (!snapshot.exists) return { skipped: ["missing"] };
          const data = snapshot.data() as DocumentData;
          const decision = evaluateRetentionCleanup({
            id: announcementId, data, today,
            followUps: followUps.docs.map(document => document.data()),
            lineNotices: lineNotices.docs.map(document => document.data()),
          });
          if (!decision.eligible) return { skipped: decision.skipReasons };
          const now = FieldValue.serverTimestamp();
          transaction.update(announcementRef, {
            publicationStatus: "withdrawn",
            ...(data.withdrawnAt ? {} : { withdrawnAt: now, withdrawnBy: actor }),
            deletionStartedAt: now,
            deletionStartedBy: actor,
          });
          return { data, decision };
        });
      } catch (error) {
        return { id: announcementId, outcome: "failed", stage: "claim", message: errorMessage(error) };
      }
      if ("skipped" in claim) return { id: announcementId, outcome: "skipped_at_claim", reasons: claim.skipped };

      if (options.afterClaim) await options.afterClaim(announcementId);

      // 2. 驗證（主文件以標記前內容判斷；標記後前端無法修改主文件）
      let verified: RetentionCleanupDecision;
      try {
        const [followUps, lineNotices] = await Promise.all([readSubcollection("followUps"), readSubcollection("lineNotices")]);
        verified = evaluateRetentionCleanup({ id: announcementId, data: claim.data, today, followUps, lineNotices });
      } catch (error) {
        // 無法驗證：保守撤銷標記，不刪除。
        const unclaimed = await unclaim(announcementId, claim.data);
        return unclaimed ? { id: announcementId, outcome: "race_unclaimed", reasons: [`verify_failed: ${errorMessage(error)}`] }
          : { id: announcementId, outcome: "failed", stage: "verify", message: errorMessage(error) };
      }

      // 3a. 撤銷
      if (!verified.eligible) {
        const unclaimed = await unclaim(announcementId, claim.data);
        return unclaimed ? { id: announcementId, outcome: "race_unclaimed", reasons: verified.skipReasons }
          : { id: announcementId, outcome: "failed", stage: "unclaim", message: "claim could not be reverted; announcement left marked for administrator" };
      }

      // 3b. 刪除（確認標記仍屬於本次執行）
      try {
        await permanentlyDeleteAnnouncement({
          firestore, announcementId, actor,
          authorize: async transaction => {
            const snapshot = await transaction.get(announcementRef);
            if (snapshot.exists && snapshot.data()?.deletionStartedBy !== actor) throw new Error("retention claim was lost before deletion");
          },
          cleanup: options.cleanup,
        });
        return { id: announcementId, outcome: "deleted", finalCleanupDate: verified.finalCleanupDate };
      } catch (error) {
        const original = error instanceof AnnouncementDeletionCleanupError ? error.original : error;
        return { id: announcementId, outcome: "failed", stage: "delete", message: errorMessage(original) };
      }

      async function unclaim(id: string, before: DocumentData) {
        try {
          return await firestore.runTransaction(async transaction => {
            const ref = firestore.collection("announcements").doc(id);
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists || snapshot.data()?.deletionStartedBy !== actor) return false;
            transaction.update(ref, {
              deletionStartedAt: FieldValue.delete(),
              deletionStartedBy: FieldValue.delete(),
              publicationStatus: before.publicationStatus === undefined ? FieldValue.delete() : before.publicationStatus,
              ...(before.withdrawnAt ? {} : { withdrawnAt: FieldValue.delete(), withdrawnBy: FieldValue.delete() }),
            });
            return true;
          });
        } catch {
          return false;
        }
      }
    },
  };
}
