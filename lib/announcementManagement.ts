import type { Announcement, FollowUp } from "./announcements.ts";
import { validateBasicDraft } from "./publishDraft.ts";

export const MANAGE_DEPARTMENT_KEY = "manageDepartment";

export function filterManagedAnnouncements(items: Announcement[], department: string, query = "") {
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  return items.filter(item => item.department === department && (!needle || `${item.title}\n${item.content}`.toLocaleLowerCase("zh-Hant").includes(needle)));
}

export function validateAnnouncementCore(item: Announcement) {
  return validateBasicDraft({ department: item.department, title: item.title, audiences: item.audiences, content: item.content, attachments: item.attachments.map(a => ({ ...a, caption: a.caption ?? "", previewUrl: a.url })), importantEvents: item.importantEvents, deadlines: item.deadlines, links: item.links });
}

export function updateAnnouncement(items: Announcement[], edited: Announcement, updatedAt: string) {
  return items.map(item => item.id === edited.id ? { ...edited, id: item.id, updatedAt } : item);
}

export function addAnnouncementFollowUp(items: Announcement[], id: string, followUp: FollowUp) {
  return items.map(item => item.id === id ? { ...item, followUps: [...item.followUps, followUp], updatedAt: followUp.createdAt } : item);
}
