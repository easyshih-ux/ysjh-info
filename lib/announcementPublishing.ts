import { collection, doc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { Announcement, Attachment, PdfAttachment } from "./announcements.ts";
import { ANNOUNCEMENTS_COLLECTION, getFirestoreClient, type FirestoreAnnouncement } from "./firestoreClient.ts";
import { getFirebaseStorageClient } from "./firebaseStorageClient.ts";
import { getFirebaseApp } from "./firebaseClient.ts";
import { compressImageToWebP, ImageCompressionError } from "./imageCompression.ts";
import { publishDraftToAnnouncement, type BasicAnnouncementDraft, type PublishImageAttachment, type PublishPdfAttachment } from "./publishDraft.ts";
import { sanitizeAttachmentName } from "./attachmentFiles.ts";

export type PublishStage = "processing-images" | "uploading-images" | "uploading-pdfs" | "publishing";

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

export function announcementPdfPath(announcementId: string, publisherUid: string, attachmentId: string) {
  return `announcements/${announcementId}/pdf/${publisherUid}/${attachmentId}.pdf`;
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
  const uploadedPaths: string[] = [];

  try {
    const pdfAttachments = draft.pdfAttachments ?? [];
    if (draft.attachments.length > 0 || pdfAttachments.length > 0) {
      if (!publisher) throw new AnnouncementPublishError("無法確認發布者身分，請重新登入後再試一次。");
      if (draft.attachments.length > 0) {
        onStage?.("processing-images");
        const compressed = await Promise.all(draft.attachments.map(async attachment => ({
          attachment,
          blob: await compressDraftImage(attachment),
        })));
        onStage?.("uploading-images");
        const images: Attachment[] = [];
        for (const { attachment, blob } of compressed) {
          uploadedPaths.push(announcementImagePath(announcementReference.id, attachment.id));
          images.push(await uploadAnnouncementImage(announcementReference.id, attachment, blob, publisher.uid));
        }
        attachments.push(...images);
      }
      if (pdfAttachments.length > 0) {
        onStage?.("uploading-pdfs");
        const pdfs: PdfAttachment[] = [];
        for (const attachment of pdfAttachments) {
          const path = announcementPdfPath(announcementReference.id, publisher.uid, attachment.id);
          uploadedPaths.push(path);
          pdfs.push(await uploadAnnouncementPdf(announcementReference.id, attachment, publisher.uid));
        }
        attachments.push(...pdfs);
      }
    }

    onStage?.("publishing");
    const document = createFirestoreAnnouncement(draft, academicYear, publishedAt, attachments, publisher);
    await setDoc(announcementReference, document);
    return { id: announcementReference.id, ...document } satisfies Announcement;
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        await cleanupFailedAnnouncementUpload(announcementReference.id);
      } catch (cleanupError) {
        console.error("failed announcement upload cleanup failed", cleanupError);
      }
    }
    if (error instanceof ImageCompressionError) throw error;
    throw new AnnouncementPublishError(
      attachments.length > 0
        ? "公告發布失敗，請確認網路連線與發布權限後再試一次。"
        : "公告發布失敗，請確認網路連線與發布權限後再試一次。",
    );
  }
}

async function cleanupFailedAnnouncementUpload(announcementId: string) {
  const callable = httpsCallable<{ announcementId: string }, { success: true }>(
    getFunctions(getFirebaseApp(), "asia-east1"),
    "cleanupFailedAnnouncementUpload",
  );
  await callable({ announcementId });
}

async function compressDraftImage(attachment: PublishImageAttachment) {
  if (!attachment.file) throw new ImageCompressionError("圖片檔案已失效，請移除後重新選擇。");
  return compressImageToWebP(attachment.file);
}

async function uploadAnnouncementImage(
  announcementId: string,
  attachment: PublishImageAttachment,
  blob: Blob,
  uploaderUid: string,
): Promise<Attachment> {
  const storageReference = ref(
    getFirebaseStorageClient(),
    announcementImagePath(announcementId, attachment.id),
  );
  await uploadBytes(storageReference, blob, {
    contentType: "image/webp",
    customMetadata: { uploaderUid },
  });
  const url = await getDownloadURL(storageReference);
  return {
    id: attachment.id,
    type: "image",
    url,
    name: attachment.name,
    caption: attachment.caption,
  };
}

async function uploadAnnouncementPdf(
  announcementId: string,
  attachment: PublishPdfAttachment,
  uploaderUid: string,
): Promise<PdfAttachment> {
  if (!attachment.file) throw new AnnouncementPublishError("PDF 檔案已失效，請移除後重新選擇。");
  const storagePath = announcementPdfPath(announcementId, uploaderUid, attachment.id);
  const storageReference = ref(getFirebaseStorageClient(), storagePath);
  await uploadBytes(storageReference, attachment.file, {
    contentType: "application/pdf",
    customMetadata: { uploaderUid },
  });
  return {
    id: attachment.id,
    type: "pdf",
    url: await getDownloadURL(storageReference),
    name: sanitizeAttachmentName(attachment.name),
    sizeBytes: attachment.sizeBytes,
    storagePath,
    contentType: "application/pdf",
  };
}
