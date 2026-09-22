import { normalizeAudiences, normalizeImportantEvent, type Announcement, type Audience, type FollowUp } from "./announcements.ts";
import { validateBasicDraft } from "./publishDraft.ts";
import { normalizeAnnouncementContact } from "./departmentContacts.ts";

export const MANAGE_DEPARTMENT_KEY = "manageDepartment";

export function resolveInitialManageDepartment(
  savedDepartment: string | null,
  publisherDepartment: string,
): string {
  return savedDepartment || publisherDepartment;
}

export function announcementPublisherLabel(item: Announcement) {
  return item.publisherDisplayName?.trim()
    || item.publisherEmail?.trim()
    || item.department?.trim()
    || "歷史公告";
}

export function filterManagedAnnouncements(items: Announcement[], department: string, query = "", audience: Audience | "全部" = "全部", academicYear?: number) {
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  return items.filter(item => (department === "全部" || item.department === department)
    && (audience === "全部" || item.audiences.includes(audience))
    && (academicYear === undefined || item.academicYear === academicYear)
    && (!needle || `${item.title}\n${item.content}\n${item.department}`.toLocaleLowerCase("zh-Hant").includes(needle)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function validateAnnouncementCore(item: Announcement) {
  return validateBasicDraft({ department: item.department, title: item.title, audiences: normalizeAudiences(item.audiences), content: item.content, contact: item.contact, attachments: item.attachments.filter(a => a.type === "image").map(a => ({ ...a, caption: a.caption ?? "", previewUrl: a.url })), importantEvents: item.importantEvents, deadlines: item.deadlines, links: item.links });
}

export function updateAnnouncement(items: Announcement[], edited: Announcement, updatedAt: string) {
  return items.map(item => item.id === edited.id ? applyAnnouncementUpdate(item, edited, updatedAt) : item);
}

export function addAnnouncementFollowUp(items: Announcement[], id: string, followUp: FollowUp) {
  return items.map(item => item.id === id ? { ...item, followUps: [...item.followUps, followUp], updatedAt: followUp.createdAt } : item);
}

export function createAnnouncementUpdate(edited: Announcement, updatedAt: string) {
  const contact = normalizeAnnouncementContact(edited.contact);
  return {
    academicYear: edited.academicYear,
    department: edited.department,
    title: edited.title.trim(),
    audiences: normalizeAudiences(edited.audiences),
    content: edited.content.trim(),
    ...(contact ? { contact } : {}),
    importantEvents: edited.importantEvents.filter(item => item.date || item.time || item.endDate || item.endTime || item.title).map(normalizeImportantEvent),
    deadlines: edited.deadlines.filter(item => item.date || item.time || item.label),
    links: edited.links,
    updatedAt,
  };
}

export function applyAnnouncementUpdate(original: Announcement, edited: Announcement, updatedAt: string): Announcement {
  return { ...original, ...createAnnouncementUpdate(edited, updatedAt), contact: normalizeAnnouncementContact(edited.contact), id: original.id, publishedAt: original.publishedAt, attachments: original.attachments, followUps: original.followUps };
}

export function createFollowUp(type: FollowUp["type"], message: string, createdAt: string): FollowUp {
  if (type !== "supplement" && type !== "reminder") throw new Error("Invalid follow-up type");
  if (!message.trim()) throw new Error("Follow-up message is required");
  return { createdAt, type, message: message.trim() };
}
