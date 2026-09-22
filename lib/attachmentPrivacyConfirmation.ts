import type { BasicAnnouncementDraft } from "./publishDraft.ts";

export const ATTACHMENT_PRIVACY_CONFIRMATION_ERROR = "請先確認附件公開內容後再發布。";

export function hasPublishAttachments(draft: Pick<BasicAnnouncementDraft, "attachments" | "pdfAttachments">) {
  return draft.attachments.length > 0 || (draft.pdfAttachments?.length ?? 0) > 0;
}

export function validateAttachmentPrivacyConfirmation(
  draft: Pick<BasicAnnouncementDraft, "attachments" | "pdfAttachments">,
  confirmed: boolean,
) {
  return hasPublishAttachments(draft) && !confirmed
    ? ATTACHMENT_PRIVACY_CONFIRMATION_ERROR
    : undefined;
}
