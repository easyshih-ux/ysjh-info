import { collectionGroup, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, type DocumentReference, type Firestore, type Timestamp, type WriteBatch } from "firebase/firestore";
import { ANNOUNCEMENTS_COLLECTION, getFirestoreClient } from "./firestoreClient.ts";
import { LINE_NOTICES_SUBCOLLECTION, lineNoticeFromFirestore, lineNoticeIds, type LineNotice } from "./lineNotices.ts";

export function lineNoticeReference(database: Firestore, announcementId: string, noticeId: string) {
  return doc(database, ANNOUNCEMENTS_COLLECTION, announcementId, LINE_NOTICES_SUBCOLLECTION, noticeId);
}

/** 首次發布：與公告同批建立（Rules 以 getAfter 驗證公告於同批新建）。 */
export function addPublishLineNotice(batch: WriteBatch, announcementRef: DocumentReference, publisherUid: string) {
  batch.set(doc(announcementRef, LINE_NOTICES_SUBCOLLECTION, lineNoticeIds.publish()), {
    type: "publish", publisherUid, status: "pending", createdBy: publisherUid, createdAt: serverTimestamp(),
  });
}

/** 重要異動：與「修正次數 +1」同批建立，保存本次通知文字快照。 */
export function addUpdateLineNotice(batch: WriteBatch, database: Firestore, announcementId: string, publisherUid: string, createdBy: string, contentUpdateCount: number, text: string) {
  batch.set(lineNoticeReference(database, announcementId, lineNoticeIds.update(contentUpdateCount)), {
    type: "update", sourceId: contentUpdateCount, publisherUid, status: "pending", text, createdBy, createdAt: serverTimestamp(),
  });
}

/** 補充／提醒：與該筆 followUp 同批建立，保存本次通知文字快照。 */
export function addFollowUpLineNotice(batch: WriteBatch, database: Firestore, announcementId: string, followUpId: string, type: "supplement" | "reminder", publisherUid: string, createdBy: string, text: string) {
  batch.set(lineNoticeReference(database, announcementId, lineNoticeIds.followUp(followUpId)), {
    type, sourceId: followUpId, publisherUid, status: "pending", text, createdBy, createdAt: serverTimestamp(),
  });
}

/**
 * 催繳：催繳由 Functions 啟動，成功後以固定 ID 建立待辦；失敗可安全重試，不會重複。
 * 回傳待辦 ID；回傳 false 表示公告目前不在催繳中。
 */
export async function createChaseLineNotice(announcementId: string, createdBy: string) {
  const database = getFirestoreClient();
  const snapshot = await getDoc(doc(database, ANNOUNCEMENTS_COLLECTION, announcementId));
  const data = snapshot.data();
  const startedAt = data?.collectionStartedAt as Timestamp | undefined;
  if (data?.collectionStatus !== "chasing" || !startedAt || typeof startedAt.toMillis !== "function" || typeof data.publisherUid !== "string") return false;
  const noticeId = lineNoticeIds.chase(startedAt.toMillis());
  const reference = lineNoticeReference(database, announcementId, noticeId);
  const existing = await getDoc(reference).catch(() => null);
  if (existing?.exists()) return noticeId;
  await setDoc(reference, { type: "chase", sourceId: startedAt, publisherUid: data.publisherUid, status: "pending", createdBy, createdAt: serverTimestamp() });
  return noticeId;
}

/** 行政管理首頁：一般發布者只查自己公告的待辦；systemAdmin 查全部。 */
export async function readPendingLineNotices(publisher: { uid: string; role: "publisher" | "systemAdmin" | null }): Promise<LineNotice[]> {
  const base = collectionGroup(getFirestoreClient(), LINE_NOTICES_SUBCOLLECTION);
  const snapshot = await getDocs(publisher.role === "systemAdmin"
    ? query(base, where("status", "==", "pending"))
    : query(base, where("publisherUid", "==", publisher.uid), where("status", "==", "pending")));
  return snapshot.docs.flatMap(item => {
    const announcementId = item.ref.parent.parent?.id;
    const notice = announcementId ? lineNoticeFromFirestore(item.id, announcementId, item.data()) : null;
    return notice ? [notice] : [];
  });
}

/** 行政人員確認「我已發送 LINE」；Rules 只允許 pending → sent 一次。 */
export async function confirmLineNoticeSent(notice: Pick<LineNotice, "announcementId" | "id">, uid: string) {
  await updateDoc(lineNoticeReference(getFirestoreClient(), notice.announcementId, notice.id), { status: "sent", sentBy: uid, sentAt: serverTimestamp() });
}
