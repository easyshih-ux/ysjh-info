import { formatImportantEventSchedule, LINE_NOTIFICATION_LEVEL_LABELS, normalizeAudienceNote, resolveLineNotificationLevel, type Announcement, type LineNotificationLevel } from "./announcements.ts";
import { createAnnouncementDirectUrl } from "./announcementDeepLink.ts";
import { formatContactInquiry } from "./departmentContacts.ts";
import { formatDepartmentFullName } from "./departments.ts";

/**
 * LINE 公告通知 V2：純文字、Emoji 與換行，不依賴 Markdown，也不複製整篇公告內容。
 * 發布成功與管理頁共用此 formatter。
 */
export function createLineAnnouncementSummary(announcement: Announcement, siteUrl: string, currentYear = new Date().getFullYear()) {
  const level = resolveLineNotificationLevel(announcement.lineNotificationLevel);
  const sections = [
    LINE_NOTIFICATION_LEVEL_LABELS[level],
    `📢 ${formatDepartmentFullName(announcement.department)}公告`,
    `📌 ${announcement.title.trim()}`,
    `👥 對象｜${normalizeAudienceNote(announcement.audienceNote) ?? announcement.audiences.join("、")}`,
  ];

  const events = uniqueLines(announcement.importantEvents.map(item => `${formatImportantEventSchedule(item, date => formatLineDate(date, undefined, currentYear))} ${item.title.trim()}`));
  if (events.length === 1) sections.push(`📅 日期｜${events[0]}`);
  else if (events.length > 1) sections.push(`📅 重要日期\n${events.map(line => `・${line}`).join("\n")}`);

  const deadlines = uniqueLines(announcement.deadlines.map(item => `${formatLineDate(item.date, item.time, currentYear)} ${item.label.trim()}`));
  if (deadlines.length === 1) sections.push(`⏰ 截止｜${deadlines[0]}`);
  else if (deadlines.length > 1) sections.push(`⏰ 截止\n${deadlines.map(line => `・${line}`).join("\n")}`);

  const action = lineActionSentence(level, deadlines.length > 0);
  if (action) sections.push(action);
  if (announcement.contact) sections.push(formatContactInquiry(announcement.contact));

  const primaryLink = announcement.links.find(link => link.isPrimary);
  if (primaryLink) sections.push(`👉 ${primaryLink.label}\n${primaryLink.url}`);
  sections.push(`🔗 完整公告及操作說明：\n${createAnnouncementDirectUrl(siteUrl, announcement.id)}`);
  return sections.join("\n\n");
}

export function lineActionSentence(level: LineNotificationLevel, hasDeadline: boolean) {
  if (level === "schoolwide") return "⚠️ 請全校同仁務必詳閱。";
  if (level === "required") return "⚠️ 請相關同仁務必詳閱並依公告辦理。";
  if (level === "task") return hasDeadline ? "⚠️ 請相關同仁於期限內完成。" : "⚠️ 請相關同仁依公告完成辦理。";
  return null;
}

/** 只合併完全相同的重複資訊。 */
function uniqueLines(lines: string[]) {
  return [...new Set(lines)];
}

export function formatLineDate(date: string, time?: string, currentYear = new Date().getFullYear()) {
  const [year, month, day] = date.split("-").map(Number);
  const displayDate = year === currentYear ? `${month}/${day}` : `${year}/${month}/${day}`;
  return time ? `${displayDate} ${time}` : displayDate;
}

export async function copyLineAnnouncement(text: string, clipboard?: Pick<Clipboard, "writeText">) {
  try {
    const target = clipboard ?? (typeof navigator === "undefined" ? undefined : navigator.clipboard);
    if (!target?.writeText) return false;
    await target.writeText(text);
    return true;
  } catch {
    return false;
  }
}
