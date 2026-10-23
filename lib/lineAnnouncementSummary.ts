import { formatImportantEventSchedule, LINE_NOTIFICATION_LEVEL_LABELS, normalizeAudienceNote, resolveLineNotificationLevel, type Announcement, type Deadline, type ImportantEvent } from "./announcements.ts";
import { createAnnouncementDirectUrl } from "./announcementDeepLink.ts";
import { formatContactInquiry } from "./departmentContacts.ts";
import { formatDepartmentFullName } from "./departments.ts";

/** 固定閱讀提醒：四種等級與後續通知共用，不隨等級變動。 */
export const LINE_READ_REMINDER = "⚠️ LINE 僅供通知，並非完整公告！請相關同仁務必點擊下方連結，詳閱公告內容，以免遺漏重要資訊及待辦事項。";

/** 第一到三行：「類型或等級＋標題」、發布單位、對象（以換行相連，不空行）。 */
export function lineNoticeHeading(label: string, announcement: Pick<Announcement, "title" | "department" | "audiences" | "audienceNote">) {
  return [
    `${label}${announcement.title.trim()}`,
    `📢 ${formatDepartmentFullName(announcement.department)}公告`,
    `👥 對象｜${normalizeAudienceNote(announcement.audienceNote) ?? announcement.audiences.join("、")}`,
  ].join("\n");
}

/** 結尾：固定閱讀提醒、聯絡資訊（有設定才顯示）、主要操作連結（首次發布才有），最後是公告專屬連結。 */
export function lineNoticeFooter(announcement: Pick<Announcement, "id" | "contact">, siteUrl: string, beforeLink: string[] = []) {
  return [
    LINE_READ_REMINDER,
    ...(announcement.contact ? [formatContactInquiry(announcement.contact)] : []),
    ...beforeLink,
    `🔗 完整公告：\n${createAnnouncementDirectUrl(siteUrl, announcement.id)}`,
  ];
}

/**
 * LINE 公告通知：純文字、Emoji 與換行，不依賴 Markdown，也不複製整篇公告內容。
 * 發布成功、管理頁與 LINE 待通知共用此 formatter。
 * 有設定的重要日期、截止期限仍保留於對象與閱讀提醒之間；主要操作連結保留於聯絡資訊之後。
 */
export function createLineAnnouncementSummary(announcement: Announcement, siteUrl: string, currentYear = new Date().getFullYear()) {
  const level = resolveLineNotificationLevel(announcement.lineNotificationLevel);
  const sections = [lineNoticeHeading(LINE_NOTIFICATION_LEVEL_LABELS[level], announcement)];

  sections.push(...lineImportantEventSection(announcement.importantEvents, currentYear), ...lineDeadlineSection(announcement.deadlines, currentYear));

  const primaryLink = announcement.links.find(link => link.isPrimary);
  sections.push(...lineNoticeFooter(announcement, siteUrl, primaryLink ? [`👉 ${primaryLink.label}\n${primaryLink.url}`] : []));
  return sections.join("\n\n");
}

/** 📅 重要日期：有設定才輸出；單筆一行，多筆全部列出（含起訖日期與時間）。 */
export function lineImportantEventSection(events: readonly ImportantEvent[], currentYear: number) {
  const lines = uniqueLines(events.map(item => `${formatImportantEventSchedule(item, date => formatLineDate(date, undefined, currentYear))} ${item.title.trim()}`));
  if (lines.length === 0) return [];
  return [lines.length === 1 ? `📅 日期｜${lines[0]}` : `📅 重要日期\n${lines.map(line => `・${line}`).join("\n")}`];
}

/** ⏰ 截止期限：與重要日期分開輸出；有設定才輸出，多筆全部列出。 */
export function lineDeadlineSection(deadlines: readonly Deadline[], currentYear: number) {
  const lines = uniqueLines(deadlines.map(item => `${formatLineDate(item.date, item.time, currentYear)} ${item.label.trim()}`));
  if (lines.length === 0) return [];
  return [lines.length === 1 ? `⏰ 截止｜${lines[0]}` : `⏰ 截止\n${lines.map(line => `・${line}`).join("\n")}`];
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
