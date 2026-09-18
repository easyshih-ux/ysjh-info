import { USER_IDENTITIES, type Announcement, type Audience, type UserIdentity } from "./announcements.ts";

export const ROLE_STORAGE_KEY = "selectedRole";
export const ACADEMIC_YEAR_STORAGE_KEY = "selectedAcademicYear";
export const SCHOOLWIDE_INCLUDES_ADMIN = false;
export type SavedIdentity = UserIdentity | "全部";

export function isSavedIdentity(value: string | null): value is SavedIdentity {
  return value === "全部" || USER_IDENTITIES.includes(value as UserIdentity);
}

export function readSavedIdentity(storage: Pick<Storage, "getItem">, currentAcademicYear: number): SavedIdentity | null {
  const value = storage.getItem(ROLE_STORAGE_KEY);
  const selectedAcademicYear = Number(storage.getItem(ACADEMIC_YEAR_STORAGE_KEY));
  return isSavedIdentity(value) && selectedAcademicYear === currentAcademicYear ? value : null;
}

export function saveIdentity(storage: Pick<Storage, "setItem">, identity: SavedIdentity, currentAcademicYear: number) {
  storage.setItem(ROLE_STORAGE_KEY, identity);
  storage.setItem(ACADEMIC_YEAR_STORAGE_KEY, String(currentAcademicYear));
}

export function needsAcademicYearConfirmation(storage: Pick<Storage, "getItem">, currentAcademicYear: number) {
  const role = storage.getItem(ROLE_STORAGE_KEY);
  const savedYear = Number(storage.getItem(ACADEMIC_YEAR_STORAGE_KEY));
  return isSavedIdentity(role) && savedYear !== currentAcademicYear;
}

export function isForIdentity(announcement: Announcement, identity: UserIdentity) {
  if (announcement.audiences.includes(identity)) return true;
  if (!announcement.audiences.includes("全校教師")) return false;
  return identity !== "行政" || SCHOOLWIDE_INCLUDES_ADMIN;
}

export function announcementsForIdentity(announcements: Announcement[], identity: UserIdentity) {
  return announcements.filter(item => isForIdentity(item, identity));
}

export const localDate = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export function weekBounds(now: Date) {
  const day = now.getDay() || 7;
  const start = localDate(now); start.setDate(start.getDate() - day + 1);
  const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function weeklyEvents(announcements: Announcement[], now: Date) {
  const { start, end } = weekBounds(now);
  return announcements.flatMap(a => a.importantEvents.map(event => ({ ...event, announcement: a })))
    .filter(item => { const d = localDate(item.date); return d >= start && d <= end; })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"));
}

export function upcomingDeadlines(announcements: Announcement[], now: Date) {
  return announcements.flatMap(a => a.deadlines.map(d => {
    const at = new Date(`${d.date}T${d.time || "23:59"}:00`);
    return { announcement: a, deadline: d, at };
  })).filter(item => item.at >= now).sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function filterAnnouncements(announcements: Announcement[], query: string, audience: Audience | "全部", department: string) {
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  return announcements.filter(a => {
    const audienceMatch = audience === "全部" || a.audiences.includes(audience);
    const departmentMatch = department === "全部" || a.department === department;
    const searchMatch = !needle || `${a.title}\n${a.content}\n${a.department}`.toLocaleLowerCase("zh-Hant").includes(needle);
    return audienceMatch && departmentMatch && searchMatch;
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function daysUntil(date: string, now: Date) {
  return Math.round((localDate(date).getTime() - localDate(now).getTime()) / 86400000);
}
