import type { Announcement, Deadline, FollowUp } from "./announcements.ts";
import { createLineAnnouncementSummary, lineDeadlineSection, lineImportantEventSection, lineNoticeFooter, lineNoticeHeading } from "./lineAnnouncementSummary.ts";

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

type NoticeAnnouncement = Pick<Announcement, "id" | "department" | "title" | "audiences" | "audienceNote" | "contact" | "importantEvents" | "deadlines">;

/**
 * 後續通知沿用首次發布的版型：類型＋標題、單位、對象 → 本次重點 → 📅 重要日期 → ⏰ 截止期限
 * → 閱讀提醒、聯絡資訊、連結。日期與期限沿用首次發布的格式化函式，有設定才顯示。
 */
function noticeText(label: string, announcement: NoticeAnnouncement, body: string[], siteUrl: string, currentYear: number, deadlines: readonly Deadline[] = announcement.deadlines) {
  return [
    lineNoticeHeading(label, announcement),
    ...body,
    ...lineImportantEventSection(announcement.importantEvents, currentYear),
    ...lineDeadlineSection(deadlines, currentYear),
    ...lineNoticeFooter(announcement, siteUrl),
  ].join("\n\n");
}

/** 提醒與催繳只列尚未截止的期限（依時間排序），已過期的期限不再提醒。 */
function upcomingDeadlines(announcement: Pick<Announcement, "deadlines">, today: string) {
  return announcement.deadlines
    .filter(item => item.date >= today)
    .sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
}

/** 重要異動：呈現異動重點，不重複整篇公告。 */
export function createUpdateNoticeText(announcement: NoticeAnnouncement, highlight: string, siteUrl: string, currentYear = new Date().getFullYear()) {
  return noticeText("🔄【公告更新】", announcement, [`✏️ 異動重點｜${highlight.trim()}`], siteUrl, currentYear);
}

/** 補充或提醒：呈現這次的補充／提醒內容；提醒只列尚未截止的期限。 */
export function createFollowUpNoticeText(
  announcement: NoticeAnnouncement,
  type: "supplement" | "reminder",
  message: string,
  siteUrl: string,
  today: string,
  currentYear = Number(today.slice(0, 4)),
) {
  if (type === "supplement") return noticeText("📌【公告補充】", announcement, [`💬 補充｜${message.trim()}`], siteUrl, currentYear);
  return noticeText("⚠️【提醒】", announcement, [`🔔 ${message.trim()}`], siteUrl, currentYear, upcomingDeadlines(announcement, today));
}

/** 催繳：顯示時依目前催繳文字與尚未截止的期限產生。 */
export function createChaseNoticeText(announcement: NoticeAnnouncement & Pick<Announcement, "collectionMessage">, siteUrl: string, today: string, currentYear = Number(today.slice(0, 4))) {
  const message = announcement.collectionMessage?.trim();
  return noticeText("🚨【催繳】", announcement, message ? [`🔔 ${message}`] : [], siteUrl, currentYear, upcomingDeadlines(announcement, today));
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
