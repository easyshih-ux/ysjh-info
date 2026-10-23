import { deleteField, doc, updateDoc, writeBatch } from "firebase/firestore";
import { addUpdateLineNotice } from "./lineNoticesFirestore.ts";
import { lineNoticeIds } from "./lineNotices.ts";
import type { Announcement, FollowUp } from "./announcements.ts";
import { createAnnouncementUpdate, hasAnnouncementContentChanges, hasImageAudienceChanges, hasLineSettingChanges, normalizeLineSettings } from "./announcementManagement.ts";
import { createAnnouncementFollowUp, withdrawAnnouncementFollowUp } from "./announcementFollowUps.ts";
import { ANNOUNCEMENTS_COLLECTION, getFirestoreClient } from "./firestoreClient.ts";
import type { AuthorizedPublisherContextValue } from "./publisherAccess.ts";

export class AnnouncementManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnouncementManagementError";
  }
}

export async function withdrawManagedFollowUp(announcementId: string, followUpId: string, publisher: Pick<AuthorizedPublisherContextValue, "uid">) {
  try { return await withdrawAnnouncementFollowUp(announcementId, followUpId, publisher.uid); }
  catch { throw new AnnouncementManagementError("撤回補充／提醒失敗，請確認權限與網路連線後再試一次。"); }
}

/**
 * 回傳 null 表示沒有任何變更；contentUpdatedAt 為 null 表示只更新 LINE 通知設定或圖片適用身分，
 * 不更新公告原文時間與次數。
 */
export async function updateManagedAnnouncement(
  original: Announcement,
  edited: Announcement,
  lineNotice?: { createdBy: string; text: string },
): Promise<{ contentUpdatedAt: string | null; lineNoticeCreated?: boolean; lineNoticeId?: string } | null> {
  const contentChanged = hasAnnouncementContentChanges(original, edited);
  const lineSettingsChanged = hasLineSettingChanges(original, edited);
  const imageAudiencesChanged = hasImageAudienceChanges(original, edited);
  if (!contentChanged && !lineSettingsChanged && !imageAudiencesChanged) return null;
  const contentUpdatedAt = contentChanged ? new Date().toISOString() : null;
  const lineSettings = normalizeLineSettings(edited);
  const nextContentUpdateCount = (original.contentUpdateCount ?? 0) + 1;
  const patch = {
    ...(contentUpdatedAt ? { ...createAnnouncementUpdate(edited, contentUpdatedAt, nextContentUpdateCount), contact: edited.contact ?? deleteField() } : {}),
    ...(lineSettingsChanged ? { lineNotificationLevel: lineSettings.lineNotificationLevel, audienceNote: lineSettings.audienceNote ?? deleteField() } : {}),
    ...(imageAudiencesChanged ? { imageAudiences: edited.imageAudiences ?? deleteField() } : {}),
  };
  try {
    // 只有實質內容修改且行政人員選擇需要通知時，才與修正次數 +1 同批建立 LINE 待辦。
    if (contentUpdatedAt && lineNotice && original.publisherUid) {
      const database = getFirestoreClient();
      const batch = writeBatch(database);
      batch.update(doc(database, ANNOUNCEMENTS_COLLECTION, edited.id), patch);
      addUpdateLineNotice(batch, database, edited.id, original.publisherUid, lineNotice.createdBy, nextContentUpdateCount, lineNotice.text);
      await batch.commit();
      return { contentUpdatedAt, lineNoticeCreated: true, lineNoticeId: lineNoticeIds.update(nextContentUpdateCount) };
    }
    await updateDoc(doc(getFirestoreClient(), ANNOUNCEMENTS_COLLECTION, edited.id), patch);
    return { contentUpdatedAt };
  } catch {
    throw new AnnouncementManagementError("公告更新失敗，請確認網路連線與發布權限後再試一次。");
  }
}

export async function appendManagedFollowUp(
  announcementId: string,
  type: FollowUp["type"],
  message: string,
  publisher: Pick<AuthorizedPublisherContextValue, "uid" | "defaultDepartment" | "displayName">,
  lineNotice?: { publisherUid: string; text: string },
) {
  try {
    return await createAnnouncementFollowUp(announcementId, type, message, publisher, lineNotice);
  } catch {
    throw new AnnouncementManagementError("補充／提醒新增失敗，請確認網路連線與發布權限後再試一次。");
  }
}
