import type { Announcement, FollowUp } from "./announcements.ts";
import { createAnnouncementDirectUrl } from "./announcementDeepLink.ts";
import { formatDepartmentFullName } from "./departments.ts";
import { createLineAnnouncementSummary, formatLineDate } from "./lineAnnouncementSummary.ts";

/**
 * LINE 通知待辦：announcements/{announcementId}/lineNotices/{noticeId}
 * 複製成功不等於已發送；只有行政人員按「我已發送 LINE」才改為 sent。
 */
export const LINE_NOTICES_SUBCOLLECTION = "lineNotices";
export type LineNoticeType = "publish" | "update" | "supplement" | "reminder" | "chase";
export type LineNoticeStatus = "pending" | "sent";
export const MAX_LINE_NOTICE_TEXT_LENGTH = 3000;
export const MAX_UPDATE_HIGHLIGHT_LENGTH = 200;

/** 預設是否勾選「需要 LINE 通知」：首次發布一律建立；重要異動、一般補充預設不勾；提醒、催繳預設勾選。 */
export const LINE_NOTICE_DEFAULT_CHECKED = { update: false, supplement: false, reminder: true, chase: true } as const;

export const LINE_NOTICE_TYPE_LABELS: Record<LineNoticeType, string> = {
  publish: "首次發布",
  update: "重要異動",
  supplement: "補充",
  reminder: "提醒",
  chase: "催繳",
};

export interface LineNotice {
  id: string;
  announcementId: string;
  type: LineNoticeType;
  sourceId?: string | number;
  publisherUid: string;
  status: LineNoticeStatus;
  text?: string;
  createdBy: string;
  createdAt: string;
  sentBy?: string;
  sentAt?: string;
}

/** 固定通知 ID：同一事件只能有一筆，重複送出或重試不會產生第二筆。 */
export const lineNoticeIds = {
  publish: () => "publish",
  update: (contentUpdateCount: number) => `update-${contentUpdateCount}`,
  followUp: (followUpId: string) => `followup-${followUpId}`,
  chase: (collectionStartedAtMillis: number) => `chase-${collectionStartedAtMillis}`,
};

function noticeHeader(label: string, announcement: Pick<Announcement, "department" | "title">) {
  return [label, `📢 ${formatDepartmentFullName(announcement.department)}公告`, `📌 ${announcement.title.trim()}`];
}

function noticeLink(siteUrl: string, announcementId: string) {
  return `🔗 完整公告：\n${createAnnouncementDirectUrl(siteUrl, announcementId)}`;
}

function upcomingDeadlineLines(announcement: Pick<Announcement, "deadlines">, today: string, currentYear: number) {
  return announcement.deadlines
    .filter(item => item.date >= today)
    .sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`))
    .map(item => `${formatLineDate(item.date, item.time, currentYear)} ${item.label.trim()}`);
}

function deadlineSection(lines: string[]) {
  if (lines.length === 0) return [];
  return [lines.length === 1 ? `⏰ 截止｜${lines[0]}` : `⏰ 截止\n${lines.map(line => `・${line}`).join("\n")}`];
}

/** 重要異動：只呈現異動重點與連結，不重複整篇公告。 */
export function createUpdateNoticeText(announcement: Pick<Announcement, "id" | "department" | "title">, highlight: string, siteUrl: string) {
  return [...noticeHeader("🔄【公告更新】", announcement), `✏️ 異動重點｜${highlight.trim()}`, noticeLink(siteUrl, announcement.id)].join("\n\n");
}

/** 補充或提醒：只呈現這次的補充／提醒內容；提醒另附尚未截止的期限。 */
export function createFollowUpNoticeText(
  announcement: Pick<Announcement, "id" | "department" | "title" | "deadlines">,
  type: "supplement" | "reminder",
  message: string,
  siteUrl: string,
  today: string,
  currentYear = Number(today.slice(0, 4)),
) {
  const body = type === "supplement" ? [`💬 補充｜${message.trim()}`] : [`🔔 ${message.trim()}`, ...deadlineSection(upcomingDeadlineLines(announcement, today, currentYear))];
  return [...noticeHeader(type === "supplement" ? "📌【公告補充】" : "⚠️【提醒】", announcement), ...body, noticeLink(siteUrl, announcement.id)].join("\n\n");
}

/** 催繳：顯示時依目前催繳文字與尚未截止的期限產生。 */
export function createChaseNoticeText(announcement: Pick<Announcement, "id" | "department" | "title" | "deadlines" | "collectionMessage">, siteUrl: string, today: string, currentYear = Number(today.slice(0, 4))) {
  const message = announcement.collectionMessage?.trim();
  return [...noticeHeader("🚨【催繳】", announcement), ...(message ? [`🔔 ${message}`] : []), ...deadlineSection(upcomingDeadlineLines(announcement, today, currentYear)), noticeLink(siteUrl, announcement.id)].join("\n\n");
}

/** 首次發布沿用 LINE V2（依最新內容產生）；催繳依目前狀態產生；其他類型使用建立時的文字快照。 */
export function lineNoticeText(notice: LineNotice, announcement: Announcement, siteUrl: string, today: string) {
  if (notice.type === "publish") return createLineAnnouncementSummary(announcement, siteUrl, Number(today.slice(0, 4)));
  if (notice.type === "chase") return createChaseNoticeText(announcement, siteUrl, today);
  return notice.text ?? "";
}

/**
 * 待通知清單：只列待發送；公告已下架、補充或提醒已撤回、催繳已結束時隱藏（不刪除，復原後會再出現）。
 * 找不到所屬公告時也隱藏。
 */
export function pendingLineNotices(notices: readonly LineNotice[], announcements: readonly Announcement[], followUpsByAnnouncement: Record<string, readonly FollowUp[]> = {}) {
  const byId = new Map(announcements.map(item => [item.id, item]));
  return notices.filter(notice => {
    if (notice.status !== "pending") return false;
    const announcement = byId.get(notice.announcementId);
    if (!announcement || announcement.publicationStatus === "withdrawn") return false;
    if (notice.type === "chase") return announcement.collectionStatus === "chasing";
    if (notice.type === "supplement" || notice.type === "reminder") {
      const followUp = followUpsByAnnouncement[notice.announcementId]?.find(item => item.id === notice.sourceId);
      return followUp?.status !== "withdrawn";
    }
    return true;
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const TYPES: readonly LineNoticeType[] = ["publish", "update", "supplement", "reminder", "chase"];
const toIso = (value: unknown) => isRecord(value) && typeof value.toDate === "function" ? (value.toDate as () => Date)().toISOString() : typeof value === "string" ? value : undefined;

/** Firestore 讀取：格式不符的資料略過。announcementId 由文件路徑提供。 */
export function lineNoticeFromFirestore(id: string, announcementId: string, value: unknown): LineNotice | null {
  if (!isRecord(value) || !TYPES.includes(value.type as LineNoticeType) || (value.status !== "pending" && value.status !== "sent")) return null;
  if (typeof value.publisherUid !== "string" || typeof value.createdBy !== "string") return null;
  const createdAt = toIso(value.createdAt);
  if (!createdAt) return null;
  return {
    id, announcementId, type: value.type as LineNoticeType, publisherUid: value.publisherUid, status: value.status, createdBy: value.createdBy, createdAt,
    ...(typeof value.sourceId === "string" || typeof value.sourceId === "number" ? { sourceId: value.sourceId } : isRecord(value.sourceId) && typeof value.sourceId.toMillis === "function" ? { sourceId: (value.sourceId.toMillis as () => number)() } : {}),
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(typeof value.sentBy === "string" ? { sentBy: value.sentBy } : {}),
    ...(toIso(value.sentAt) ? { sentAt: toIso(value.sentAt) } : {}),
  };
}
