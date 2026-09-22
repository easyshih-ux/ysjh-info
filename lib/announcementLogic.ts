import { USER_IDENTITIES, type Announcement, type Audience, type UserIdentity } from "./announcements.ts";

export const ROLE_STORAGE_KEY = "selectedRole";
export const ACADEMIC_YEAR_STORAGE_KEY = "selectedAcademicYear";
export const SCHOOLWIDE_INCLUDES_ADMIN = true;
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
  const date = typeof value === "string" ? calendarDate(value) : value;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

function calendarDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function weekBounds(now: Date) {
  const day = now.getDay();
  const start = localDate(now); start.setDate(start.getDate() - day);
  const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function nextWeekBounds(now: Date) {
  const current = weekBounds(now);
  const start = new Date(current.start); start.setDate(start.getDate() + 7);
  const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function weeklyEvents(announcements: Announcement[], now: Date) {
  const { start, end } = weekBounds(now);
  const today = localDate(now);
  return announcements.flatMap(a => a.importantEvents.map(event => ({ ...event, announcement: a })))
    .filter(item => {
      const eventStart = localDate(item.date);
      const eventEnd = localDate(item.endDate || item.date);
      return eventStart <= end && eventEnd >= start && eventEnd >= today;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"));
}

export function nextWeekEvents(announcements: Announcement[], now: Date) {
  const { start, end } = nextWeekBounds(now);
  return announcements.flatMap(a => a.importantEvents.map(event => ({ ...event, announcement: a })))
    .filter(item => { const eventStart = localDate(item.date); return eventStart >= start && eventStart <= end; })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"));
}

export function chasingAnnouncements(announcements: Announcement[]) {
  return announcements.filter(item => item.collectionStatus === "chasing" && item.publicationStatus !== "withdrawn");
}

export function upcomingDeadlines(announcements: Announcement[], now: Date) {
  return announcements.flatMap(a => a.deadlines.map(d => {
    const at = localDate(d.date);
    return { announcement: a, deadline: d, at };
  })).filter(item => item.at >= localDate(now)).sort((a, b) => itemDateKey(a.deadline.date, a.deadline.time).localeCompare(itemDateKey(b.deadline.date, b.deadline.time)));
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
  const target = localDate(date);
  const today = localDate(now);
  return Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}

export function importantEventDateLabel(date: string, now: Date) {
  const days = daysUntil(date, now);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  const value = localDate(date);
  return `${value.getMonth() + 1}/${value.getDate()}（${["日", "一", "二", "三", "四", "五", "六"][value.getDay()]}）`;
}

export function deadlineRelativeLabel(date: string, now: Date) {
  const days = daysUntil(date, now);
  if (days === 0) return "今天截止";
  if (days === 1) return "明天截止";
  return `剩 ${days} 天`;
}

export function deadlineDateLabel(date: string) {
  const value = localDate(date);
  return `${String(value.getMonth() + 1).padStart(2, "0")}/${String(value.getDate()).padStart(2, "0")} 截止`;
}

export function deadlineUrgency(date: string, now: Date): "red" | "orange" | "normal" {
  const days = daysUntil(date, now);
  if (days >= 0 && days <= 2) return "red";
  if (days >= 3 && days <= 5) return "orange";
  return "normal";
}

export function announcementTimeStates(announcement: Announcement, now: Date) {
  const today = localDate(now);
  const deadlineDays = announcement.deadlines.map(item => daysUntil(item.date, now));
  const deadline = deadlineDays.length === 0 ? "正常" : deadlineDays.some(days => days >= 0 && days <= 5)
    ? "即將截止"
    : deadlineDays.every(days => days < 0) ? "已截止" : "正常";
  const ongoing = announcement.importantEvents.some(event => localDate(event.date) <= today && localDate(event.endDate || event.date) >= today);
  const ended = announcement.importantEvents.length > 0 && announcement.importantEvents.every(event => localDate(event.endDate || event.date) < today);
  return { deadline, activity: ongoing ? "活動進行中" : ended ? "活動已結束" : "正常" } as const;
}

function itemDateKey(date: string, time?: string) {
  return `${date}T${time || "23:59"}`;
}
