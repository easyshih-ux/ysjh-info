import { normalizeAudiences, normalizeImportantEvent, type Announcement, type AnnouncementLink, type Audience, type Deadline, type ImportantEvent } from "./announcements.ts";
import { isDepartment, type Department } from "./departments.ts";

export interface BasicAnnouncementDraft {
  department: Department | "";
  title: string;
  audiences: Audience[];
  content: string;
  attachments: PublishImageAttachment[];
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
    importantEvents: draft.importantEvents.filter(event => event.date || event.time || event.endDate || event.endTime || event.title).map(normalizeImportantEvent),
    deadlines: draft.deadlines.filter(deadline => deadline.date || deadline.time || deadline.label),
    links: draft.links,
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
  if (draft.importantEvents.some(item => (item.date || item.time || item.endDate || item.endTime || item.title) && (!item.date || !item.title.trim()))) errors.importantEvents = "已填寫的重要事項需要完整的日期與事項名稱";
  if (draft.importantEvents.some(item => item.endDate && (!item.date || item.endDate < item.date))) errors.importantEvents = "重要事項的結束日期不得早於開始日期";
  if (draft.importantEvents.some(item => item.time && item.endTime && (!item.endDate || item.endDate === item.date) && item.endTime < item.time)) errors.importantEvents = "同一天的重要事項結束時間不得早於開始時間";
  if (draft.deadlines.some(item => (item.date || item.time || item.label) && (!item.date || !item.label.trim()))) errors.deadlines = "已填寫的繳交期限需要完整的截止日期與事項名稱";
  if (draft.links.some(item => !item.label.trim() || !isHttpUrl(item.url))) errors.links = "相關網址需要完整名稱與有效的 http/https 網址";
  if (draft.links.filter(item => item.isPrimary).length > 1) errors.links = "相關網址最多只能設定一個主要連結";
  return errors;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
