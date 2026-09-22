import { isImportantEventUsed, normalizeAudiences, normalizeImportantEvent, type Announcement, type AnnouncementLink, type Audience, type Deadline, type ImportantEvent } from "./announcements.ts";
import { isDepartment, type Department } from "./departments.ts";
import { isSupportedPdf, MAX_PDF_BYTES, MAX_PUBLISH_PDFS } from "./attachmentFiles.ts";
import { normalizeAnnouncementContact, validateAnnouncementContact, type AnnouncementContact } from "./departmentContacts.ts";

export interface BasicAnnouncementDraft {
  department: Department | "";
  title: string;
  audiences: Audience[];
  content: string;
  contact?: AnnouncementContact;
  attachments: PublishImageAttachment[];
  pdfAttachments?: PublishPdfAttachment[];
  importantEvents: ImportantEvent[];
  deadlines: Deadline[];
  links: AnnouncementLink[];
}

export interface PublishImageAttachment {
  id: string;
  type: "image";
  name: string;
  caption: string;
  previewUrl: string;
  file?: File;
}

export interface PublishPdfAttachment {
  id: string;
  type: "pdf";
  name: string;
  sizeBytes: number;
  file?: File;
}

export interface ImageFileLike { name: string; type: string; size?: number }

export const MAX_PUBLISH_IMAGES = 5;
export const MAX_ORIGINAL_IMAGE_BYTES = 10 * 1024 * 1024;

export function isSupportedImage(file: ImageFileLike) {
  return file.type.startsWith("image/");
}

export function limitPublishImageSelection<T>(items: readonly T[], currentCount: number) {
  const available = Math.max(0, MAX_PUBLISH_IMAGES - currentCount);
  const accepted = items.slice(0, available);
  return { accepted, rejectedCount: items.length - accepted.length };
}

export function selectPublishImages<T extends ImageFileLike>(items: readonly T[], currentCount: number) {
  const images = items.filter(isSupportedImage);
  const validSize = images.filter(item => (item.size ?? 0) <= MAX_ORIGINAL_IMAGE_BYTES);
  const oversizedCount = images.length - validSize.length;
  const { accepted, rejectedCount: overLimitCount } = limitPublishImageSelection(validSize, currentCount);
  return { accepted, oversizedCount, overLimitCount };
}

export function removePublishAttachment(attachments: PublishImageAttachment[], id: string) {
  return attachments.filter(item => item.id !== id);
}

export function setPrimaryLink(links: AnnouncementLink[], id: string, isPrimary: boolean) {
  return links.map(link => ({ ...link, isPrimary: isPrimary ? link.id === id : link.id === id ? false : link.isPrimary }));
}

export function publishDraftToAnnouncement(draft: BasicAnnouncementDraft, id: string, publishedAt: string, academicYear: number): Announcement {
  if (!isDepartment(draft.department)) throw new Error("Invalid department");
  return {
    id, publishedAt, academicYear, department: draft.department, title: draft.title,
    audiences: normalizeAudiences(draft.audiences), content: draft.content,
    ...(normalizeAnnouncementContact(draft.contact) ? { contact: normalizeAnnouncementContact(draft.contact) } : {}),
    importantEvents: draft.importantEvents.filter(isImportantEventUsed).map(normalizeImportantEvent),
    deadlines: draft.deadlines.filter(deadline => deadline.date || deadline.time || deadline.label),
    links: draft.links
      .filter(link => link.label.trim() || link.url.trim())
      .map(link => ({ ...link, label: link.label.trim(), url: normalizeOptionalHttpUrl(link.url).value })),
    attachments: draft.attachments.map(({ previewUrl, file: _file, ...attachment }) => ({ ...attachment, url: previewUrl })),
    followUps: [],
  };
}

export type DraftErrors = Partial<Record<keyof BasicAnnouncementDraft, string>>;

export function validateBasicDraft(draft: BasicAnnouncementDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!isDepartment(draft.department)) errors.department = "請選擇正式發布單位";
  if (!draft.title.trim()) errors.title = "請輸入公告標題";
  if (draft.audiences.length === 0) errors.audiences = "請至少選擇一個適用對象";
  if (draft.audiences.includes("全校教師") && draft.audiences.length > 1) errors.audiences = "全校教師不可與其他適用對象同時選擇";
  if (!draft.content.trim()) errors.content = "請輸入完整公告內容";
  const contactError = validateAnnouncementContact(draft.contact);
  if (contactError) errors.contact = contactError;
  const enteredImportantEvents = draft.importantEvents.filter(isImportantEventUsed);
  if (enteredImportantEvents.some(item => !item.date)) errors.importantEvents = "請填寫重要事項的開始日期";
  else if (enteredImportantEvents.some(item => !item.title.trim())) errors.importantEvents = "請填寫重要事項的事項名稱";
  else if (enteredImportantEvents.some(item => item.endDate && item.endDate < item.date)) errors.importantEvents = "重要事項的結束日期不得早於開始日期";
  else if (enteredImportantEvents.some(item => item.time && item.endTime && (!item.endDate || item.endDate === item.date) && item.endTime < item.time)) errors.importantEvents = "同一天的重要事項結束時間不得早於開始時間";
  if (draft.deadlines.some(item => (item.date || item.time || item.label) && (!item.date || !item.label.trim()))) errors.deadlines = "已填寫的繳交期限需要完整的截止日期與事項名稱";
  const enteredLinks = draft.links.filter(item => item.label.trim() || item.url.trim());
  if (enteredLinks.some(item => !item.label.trim() || !item.url.trim())) errors.links = "相關連結需要完整名稱與網址";
  else if (enteredLinks.some(item => normalizeOptionalHttpUrl(item.url).error)) errors.links = "「相關連結」網址格式不正確";
  if (draft.links.filter(item => item.isPrimary).length > 1) errors.links = "相關網址最多只能設定一個主要連結";
  if (draft.attachments.length > MAX_PUBLISH_IMAGES) errors.attachments = "每則公告最多 5 張圖片";
  else if (draft.attachments.some(item => item.file && (!isSupportedImage(item.file) || item.file.size > MAX_ORIGINAL_IMAGE_BYTES))) errors.attachments = "圖片格式不正確或單張原始圖片超過 10 MB";
  const pdfAttachments = draft.pdfAttachments ?? [];
  if (pdfAttachments.length > MAX_PUBLISH_PDFS) errors.pdfAttachments = "每則公告最多 2 份 PDF";
  else if (pdfAttachments.some(item => item.sizeBytes > MAX_PDF_BYTES)) errors.pdfAttachments = "PDF 單檔不可超過 5 MB";
  else if (pdfAttachments.some(item => !item.file || !isSupportedPdf(item.file))) errors.pdfAttachments = "PDF 格式不正確，請重新選擇檔案";
  return errors;
}

export function normalizeOptionalHttpUrl(value: string): { value: string; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { value: "" };
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  if (!hasProtocol && !isLikelyDomain(trimmed)) {
    return { value: trimmed, error: "網址格式不正確，請輸入完整網址，例如：https://www.example.com" };
  }
  const normalized = hasProtocol ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(normalized);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) {
      const value = url.pathname === "/" && !url.search && !url.hash && !normalized.endsWith("/")
        ? url.href.slice(0, -1)
        : url.href;
      return { value };
    }
  } catch {
    // Return the same user-facing validation message for malformed URLs.
  }
  return { value: trimmed, error: "網址格式不正確，請輸入完整網址，例如：https://www.example.com" };
}

function isLikelyDomain(value: string) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(value);
}
