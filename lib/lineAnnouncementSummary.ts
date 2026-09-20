import type { Announcement } from "./announcements.ts";

export function createLineAnnouncementSummary(announcement: Announcement, siteUrl: string, currentYear = new Date().getFullYear()) {
  const sections = [
    `📢【${announcement.department}公告】\n${announcement.title}`,
    `👥 對象：${announcement.audiences.join("、")}`,
  ];

  if (announcement.importantEvents.length > 0) {
    sections.push(`📅 重要日期：\n${announcement.importantEvents.map(item => `・${formatLineDate(item.date, item.time, currentYear)}${item.endDate ? ` ～ ${formatLineDate(item.endDate, undefined, currentYear)}` : ""} ${item.title}`).join("\n")}`);
  }
  if (announcement.deadlines.length > 0) {
    sections.push(`⏰ 截止：\n${announcement.deadlines.map(item => `・${formatLineDate(item.date, item.time, currentYear)} ${item.label}`).join("\n")}`);
  }

  const primaryLink = announcement.links.find(link => link.isPrimary);
  if (primaryLink) sections.push(`🔗 主要連結：${primaryLink.label}\n${primaryLink.url}`);
  sections.push(`🔎 完整公告、附件及最新補充請至「義學公務資訊站」查看：\n${siteUrl}`);
  return sections.join("\n\n");
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
