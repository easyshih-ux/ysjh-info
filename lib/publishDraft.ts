import type { Announcement, AnnouncementLink, Audience, Deadline, ImportantEvent } from "./announcements.ts";
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
}

export interface ImageFileLike { name: string; type: string }

export function isSupportedImage(file: ImageFileLike) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
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
    audiences: draft.audiences, content: draft.content,
    importantEvents: draft.importantEvents.filter(event => event.date || event.time || event.title),
    deadlines: draft.deadlines.filter(deadline => deadline.date || deadline.time || deadline.label),
    links: draft.links,
    attachments: draft.attachments.map(({ previewUrl, ...attachment }) => ({ ...attachment, url: previewUrl })),
    followUps: [],
  };
}

export type DraftErrors = Partial<Record<keyof BasicAnnouncementDraft, string>>;

export function validateBasicDraft(draft: BasicAnnouncementDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!isDepartment(draft.department)) errors.department = "請選擇正式發布單位";
  if (!draft.title.trim()) errors.title = "請輸入公告標題";
  if (draft.audiences.length === 0) errors.audiences = "請至少選擇一個適用對象";
  if (!draft.content.trim()) errors.content = "請輸入完整公告內容";
  if (draft.importantEvents.some(item => (item.date || item.time || item.title) && (!item.date || !item.title.trim()))) errors.importantEvents = "已填寫的重要事項需要完整的日期與事項名稱";
  if (draft.deadlines.some(item => (item.date || item.time || item.label) && (!item.date || !item.label.trim()))) errors.deadlines = "已填寫的繳交期限需要完整的截止日期與事項名稱";
  return errors;
}
