import type { Announcement, Audience, FollowUp } from "./announcements.ts";
import { validateBasicDraft } from "./publishDraft.ts";

export const MANAGE_DEPARTMENT_KEY = "manageDepartment";

export function filterManagedAnnouncements(items: Announcement[], department: string, query = "", audience: Audience | "全部" = "全部", academicYear?: number) {
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  return items.filter(item => (department === "全部" || item.department === department)
    && (audience === "全部" || item.audiences.includes(audience))
    && (academicYear === undefined || item.academicYear === academicYear)
    && (!needle || `${item.title}\n${item.content}\n${item.department}`.toLocaleLowerCase("zh-Hant").includes(needle)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function validateAnnouncementCore(item: Announcement) {
  return validateBasicDraft({ department: item.department, title: item.title, audiences: item.audiences, content: item.content, attachments: item.attachments.map(a => ({ ...a, caption: a.caption ?? "", previewUrl: a.url })), importantEvents: item.importantEvents, deadlines: item.deadlines, links: item.links });
}

export function updateAnnouncement(items: Announcement[], edited: Announcement, updatedAt: string) {
  return items.map(item => item.id === edited.id ? applyAnnouncementUpdate(item, edited, updatedAt) : item);
}

export function addAnnouncementFollowUp(items: Announcement[], id: string, followUp: FollowUp) {
  return items.map(item => item.id === id ? { ...item, followUps: [...item.followUps, followUp], updatedAt: followUp.createdAt } : item);
}

export function createAnnouncementUpdate(edited: Announcement, updatedAt: string) {
  return {
    academicYear: edited.academicYear,
    department: edited.department,
    title: edited.title.trim(),
    audiences: edited.audiences,
    content: edited.content.trim(),
    importantEvents: edited.importantEvents.filter(item => item.date || item.time || item.title),
    deadlines: edited.deadlines.filter(item => item.date || item.time || item.label),
    links: edited.links,
    updatedAt,
  };
}

export function applyAnnouncementUpdate(original: Announcement, edited: Announcement, updatedAt: string): Announcement {
  return { ...original, ...createAnnouncementUpdate(edited, updatedAt), id: original.id, publishedAt: original.publishedAt, attachments: original.attachments, followUps: original.followUps };
}

export function createFollowUp(type: FollowUp["type"], message: string, createdAt: string): FollowUp {
  if (type !== "supplement" && type !== "reminder") throw new Error("Invalid follow-up type");
  if (!message.trim()) throw new Error("Follow-up message is required");
  return { createdAt, type, message: message.trim() };
}
