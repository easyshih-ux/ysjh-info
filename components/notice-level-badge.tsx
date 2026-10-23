import { LINE_NOTIFICATION_LEVEL_LABELS, resolveLineNotificationLevel, type Announcement } from "@/lib/announcements";

/**
 * 老師端公告標題前的通知等級標籤（與 LINE 發布通知同一組文字）。
 * 舊公告沒有等級或值不正確時，一律顯示一般公告；標籤不寫入標題文字本身。
 */
export function NoticeLevelBadge({ announcement }: { announcement: Pick<Announcement, "lineNotificationLevel"> }) {
  const level = resolveLineNotificationLevel(announcement.lineNotificationLevel);
  return <span className={`notice-level notice-level-${level}`}>{LINE_NOTIFICATION_LEVEL_LABELS[level]}</span>;
}
