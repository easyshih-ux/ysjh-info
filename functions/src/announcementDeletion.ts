import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";

/**
 * 公告永久刪除（後端內部共用）。這是一般函式，不是 Cloud Functions 觸發器，也不從 index.ts 匯出，
 * 前端無法直接呼叫；目前只有 manageAnnouncementLifecycle（systemAdmin 驗證後）使用。
 *
 * 順序（與 Gate 4B-1 前的 callable 實作相同）：
 * 1. 交易內：執行呼叫端的 authorize（可讀取並驗證權限或資格，失敗即拋出、不寫入），
 *    再讀取公告；存在時下架並標記 deletionStartedAt（已有標記不重設）。
 * 2. 清子集合 → 清 Storage `announcements/{id}/` → 再清一次子集合（收掉標記前已送出、稍晚寫入的子文件）。
 * 3. 交易內刪除公告主文件（主文件最後才刪，不會留下「主文件已刪、附件仍在」的狀態）。
 * 任何清理步驟失敗：主文件保留為已下架＋刪除標記，可安全重試；公告已不存在時仍會清理殘留子集合與附件。
 */
export interface AnnouncementDeletionCleanup {
  cleanupSubcollections: (announcementRef: DocumentReference) => Promise<void>;
  cleanupStorage: (announcementId: string) => Promise<void>;
}

export class AnnouncementDeletionCleanupError extends Error {
  readonly announcementId: string;
  readonly original: unknown;
  constructor(announcementId: string, original: unknown) {
    super("announcement deletion cleanup failed");
    this.name = "AnnouncementDeletionCleanupError";
    this.announcementId = announcementId;
    this.original = original;
  }
}

export async function permanentlyDeleteAnnouncement(options: {
  firestore: Firestore;
  announcementId: string;
  /** 記錄在 withdrawnBy／deletionStartedBy；人工刪除為管理員 UID。 */
  actor: string;
  /** 在標記交易內、讀取公告前執行；拋出即中止，不會寫入任何資料。 */
  authorize: (transaction: Transaction) => Promise<void>;
  cleanup: AnnouncementDeletionCleanup;
}) {
  const { firestore, announcementId, actor, authorize, cleanup } = options;
  const announcementRef = firestore.collection("announcements").doc(announcementId);

  // 先標記刪除中並下架，讓前台不再顯示，也讓 Rules 與其他動作拒絕新的寫入。
  await firestore.runTransaction(async transaction => {
    await authorize(transaction);
    const announcementSnapshot = await transaction.get(announcementRef);
    // 公告已不存在時仍繼續清理，讓舊版刪除留下的子集合與附件也能重試清掉。
    if (!announcementSnapshot.exists) return;
    const current = announcementSnapshot.data();
    const now = FieldValue.serverTimestamp();
    transaction.update(announcementRef, {
      publicationStatus: "withdrawn",
      ...(current?.withdrawnAt ? {} : { withdrawnAt: now, withdrawnBy: actor }),
      ...(current?.deletionStartedAt ? {} : { deletionStartedAt: now, deletionStartedBy: actor }),
    });
  });

  try {
    await cleanup.cleanupSubcollections(announcementRef);
    await cleanup.cleanupStorage(announcementId);
    // 再清一次，收掉標記前已送出、稍晚才寫入的子文件。
    await cleanup.cleanupSubcollections(announcementRef);
  } catch (error) {
    throw new AnnouncementDeletionCleanupError(announcementId, error);
  }

  await firestore.runTransaction(async transaction => {
    const announcementSnapshot = await transaction.get(announcementRef);
    if (announcementSnapshot.exists) transaction.delete(announcementRef);
  });
}
