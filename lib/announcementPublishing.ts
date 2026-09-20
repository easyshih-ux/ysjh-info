import { collection, doc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import type { Announcement, Attachment } from "./announcements.ts";
import { ANNOUNCEMENTS_COLLECTION, getFirestoreClient, type FirestoreAnnouncement } from "./firestoreClient.ts";
import { getFirebaseStorageClient } from "./firebaseStorageClient.ts";
import { compressImageToWebP, ImageCompressionError } from "./imageCompression.ts";
import { publishDraftToAnnouncement, type BasicAnnouncementDraft, type PublishImageAttachment } from "./publishDraft.ts";

export type PublishStage = "processing-images" | "uploading-images" | "publishing";

export class AnnouncementPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnouncementPublishError";
  }
}

export function createFirestoreAnnouncement(
  draft: BasicAnnouncementDraft,
  academicYear: number,
  publishedAt: string,
  attachments: Attachment[] = [],
  publisher?: { uid: string; email: string; displayName: string | null },
): FirestoreAnnouncement {
  const announcement: Announcement = publishDraftToAnnouncement(
    draft,
    "firestore-auto-id",
    publishedAt,
    academicYear,
  );
  const { id: _documentId, ...document } = announcement;

  return {
    ...document,
    updatedAt: publishedAt,
    attachments,
    ...(publisher ? {
      publisherUid: publisher.uid,
      publisherEmail: publisher.email,
      ...(publisher.displayName ? { publisherDisplayName: publisher.displayName } : {}),
      publicationStatus: "published" as const,
    } : {}),
  };
}

export function announcementImagePath(announcementId: string, imageId: string) {
  return `announcements/${announcementId}/${imageId}.webp`;
}

export async function publishAnnouncement(
  draft: BasicAnnouncementDraft,
  academicYear: number,
  onStage?: (stage: PublishStage) => void,
  publisher?: { uid: string; email: string; displayName: string | null },
) {
  const database = getFirestoreClient();
  const announcementReference = doc(collection(database, ANNOUNCEMENTS_COLLECTION));
  const publishedAt = new Date().toISOString();
  let attachments: Attachment[] = [];

  try {
    if (draft.attachments.length > 0) {
      onStage?.("processing-images");
      const compressed = await Promise.all(draft.attachments.map(async attachment => ({
        attachment,
        blob: await compressDraftImage(attachment),
      })));
      onStage?.("uploading-images");
      attachments = await Promise.all(compressed.map(({ attachment, blob }) =>
        uploadAnnouncementImage(announcementReference.id, attachment, blob),
      ));
    }

    onStage?.("publishing");
    const document = createFirestoreAnnouncement(draft, academicYear, publishedAt, attachments, publisher);
    await setDoc(announcementReference, document);
    return { id: announcementReference.id, ...document } satisfies Announcement;
  } catch (error) {
    if (error instanceof ImageCompressionError) throw error;
    throw new AnnouncementPublishError(
      attachments.length > 0
        ? "公告發布失敗，已上傳的圖片可能需要由管理者清理，請稍後再試。"
        : "公告發布失敗，請確認網路連線與發布權限後再試一次。",
    );
  }
}

async function compressDraftImage(attachment: PublishImageAttachment) {
  if (!attachment.file) throw new ImageCompressionError("圖片檔案已失效，請移除後重新選擇。");
  return compressImageToWebP(attachment.file);
}

async function uploadAnnouncementImage(
  announcementId: string,
  attachment: PublishImageAttachment,
  blob: Blob,
): Promise<Attachment> {
  const storageReference = ref(
    getFirebaseStorageClient(),
    announcementImagePath(announcementId, attachment.id),
  );
  await uploadBytes(storageReference, blob, { contentType: "image/webp" });
  const url = await getDownloadURL(storageReference);
  return {
    id: attachment.id,
    type: "image",
    url,
    name: attachment.name,
    caption: attachment.caption,
  };
}
