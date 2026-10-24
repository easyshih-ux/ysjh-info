import { LINE_NOTIFICATION_LEVELS, USER_IDENTITIES, resolveLineNotificationLevel, type Announcement, type Audience, type ImportantEvent, type LineNotificationLevel, type UserIdentity } from "./announcements.ts";
import { parseCalendarDate, taipeiDateKey } from "./taipeiDate.ts";

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
  return parseCalendarDate(typeof value === "string" ? value : taipeiDateKey(value));
};

export function weekBounds(now: Date) {
  const start = localDate(now);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

export function nextWeekBounds(now: Date) {
  const current = weekBounds(now);
  const start = new Date(current.start);
  start.setUTCDate(start.getUTCDate() + 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
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

/** 首頁「重要公告・請留意」：沿用 LINE V2 的全校必讀／重要必讀等級，且沒有設定活動日期與繳交期限。 */
export const IMPORTANT_NOTICE_LEVELS: readonly LineNotificationLevel[] = ["schoolwide", "required"];
/** 發布當日起算 7 個台北日曆天（含發布當天）；修改公告不延長。 */
export const IMPORTANT_NOTICE_DAYS = 7;
export const IMPORTANT_NOTICE_PREVIEW_LIMIT = 3;

export function importantNoticeDayIndex(announcement: Pick<Announcement, "publishedAt">, now: Date) {
  const published = new Date(announcement.publishedAt);
  if (Number.isNaN(published.getTime())) return null;
  return 0 - daysUntil(taipeiDateKey(published), now) || 0;
}

/**
 * 是否「沒有設定活動日期與繳交期限」：只看 importantEvents／deadlines 欄位
 * （讀取時已由 announcementFromFirestore 過濾掉不完整的項目），不看發布日期或標題文字。
 * 有日期的公告由本週／下週重要事項、即將截止等區塊呈現。
 */
export function hasNoScheduledDates(announcement: Pick<Announcement, "importantEvents" | "deadlines">) {
  return announcement.importantEvents.length === 0 && announcement.deadlines.length === 0;
}

export function isImportantNoticeActive(announcement: Announcement, now: Date) {
  const level = resolveLineNotificationLevel(announcement.lineNotificationLevel);
  const dayIndex = importantNoticeDayIndex(announcement, now);
  return announcement.publicationStatus !== "withdrawn"
    && IMPORTANT_NOTICE_LEVELS.includes(level)
    && hasNoScheduledDates(announcement)
    && dayIndex !== null
    && dayIndex >= 0
    && dayIndex < IMPORTANT_NOTICE_DAYS;
}

/**
 * announcements 應為首頁已依身分、檢視模式與學年度篩選後的公告；
 * excludedIds 為已出現在催繳、本週、下週、即將截止的公告，避免重複顯示。
 */
export function importantNoticeAnnouncements(announcements: readonly Announcement[], now: Date, excludedIds: Iterable<string> = []) {
  const excluded = new Set(excludedIds);
  const rank = (item: Announcement) => resolveLineNotificationLevel(item.lineNotificationLevel) === "schoolwide" ? 0 : 1;
  return announcements
    .filter(item => !excluded.has(item.id) && isImportantNoticeActive(item, now))
    .sort((a, b) => rank(a) - rank(b) || b.publishedAt.localeCompare(a.publishedAt));
}

/** 預設顯示前 3 則；展開時顯示全部符合資格的重要公告。 */
export function visibleImportantNotices<T>(items: readonly T[], expanded: boolean) {
  const visible = expanded ? [...items] : items.slice(0, IMPORTANT_NOTICE_PREVIEW_LIMIT);
  return { visible, total: items.length, canExpand: items.length > IMPORTANT_NOTICE_PREVIEW_LIMIT };
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

/** 搜尋與篩選清單的排序：最新優先（預設）或重要程度優先。 */
export const ANNOUNCEMENT_SORT_MODES = ["newest", "importance"] as const;
export type AnnouncementSortMode = (typeof ANNOUNCEMENT_SORT_MODES)[number];
export const ANNOUNCEMENT_SORT_LABELS: Record<AnnouncementSortMode, string> = { newest: "最新優先", importance: "重要程度優先" };

/** 等級權重沿用 LINE_NOTIFICATION_LEVELS 的順序：全校必讀 → 重要必讀 → 待辦事項 → 一般公告；未設定等級視為一般公告。 */
export function noticeLevelRank(announcement: Pick<Announcement, "lineNotificationLevel">) {
  return LINE_NOTIFICATION_LEVELS.indexOf(resolveLineNotificationLevel(announcement.lineNotificationLevel));
}

export function filterAnnouncements(announcements: Announcement[], query: string, audience: Audience | "全部", department: string, sort: AnnouncementSortMode = "newest") {
  const needle = query.trim().toLocaleLowerCase("zh-Hant");
  return announcements.filter(a => {
    const audienceMatch = audience === "全部" || a.audiences.includes(audience);
    const departmentMatch = department === "全部" || a.department === department;
    const searchMatch = !needle || `${a.title}\n${a.content}\n${a.department}`.toLocaleLowerCase("zh-Hant").includes(needle);
    return audienceMatch && departmentMatch && searchMatch;
  }).sort((a, b) => (sort === "importance" ? noticeLevelRank(a) - noticeLevelRank(b) : 0) || b.publishedAt.localeCompare(a.publishedAt));
}

export function daysUntil(date: string, now: Date) {
  const target = localDate(date);
  const today = localDate(now);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function importantEventDateLabel(date: string, now: Date) {
  const days = daysUntil(date, now);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  const value = localDate(date);
  return `${value.getUTCMonth() + 1}/${value.getUTCDate()}（${["日", "一", "二", "三", "四", "五", "六"][value.getUTCDay()]}）`;
}

export function weeklyEventDisplay(event: ImportantEvent, now: Date) {
  const { start } = weekBounds(now);
  const eventStart = localDate(event.date);
  const eventEnd = localDate(event.endDate || event.date);
  const isContinuingThisWeek = Boolean(event.endDate) && eventStart < start && eventEnd >= start && eventEnd >= localDate(now);
  const calendarParts = (date: string) => {
    const value = localDate(date);
    return { year: value.getUTCFullYear(), monthDay: `${value.getUTCMonth() + 1}/${value.getUTCDate()}` };
  };

  if (isContinuingThisWeek) {
    const startParts = calendarParts(event.date);
    const endParts = calendarParts(event.endDate!);
    const period = startParts.year === endParts.year
      ? `${startParts.monthDay}～${endParts.monthDay}`
      : `${startParts.year}/${startParts.monthDay}～${endParts.year}/${endParts.monthDay}`;
    return {
      dateLabel: "本週持續",
      contextLabel: "跨週事項",
      periodLabel: `重要事件：${period}`,
    };
  }

  return {
    dateLabel: importantEventDateLabel(event.date, now),
    contextLabel: null,
    periodLabel: null,
  };
}

export function deadlineRelativeLabel(date: string, now: Date) {
  const days = daysUntil(date, now);
  if (days === 0) return "今天截止";
  if (days === 1) return "明天截止";
  return `剩 ${days} 天`;
}

export function deadlineDateLabel(date: string) {
  const value = localDate(date);
  return `${String(value.getUTCMonth() + 1).padStart(2, "0")}/${String(value.getUTCDate()).padStart(2, "0")} 截止`;
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
