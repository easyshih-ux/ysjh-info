export const AUDIENCES = ["七年級導師", "八年級導師", "九年級導師", "專任教師", "行政", "全校教師"] as const;
export { DEPARTMENTS } from "./departments.ts";
export type { Department } from "./departments.ts";

export type Audience = (typeof AUDIENCES)[number];
import type { Department } from "./departments.ts";
import type { AnnouncementContact } from "./departmentContacts.ts";
export const USER_IDENTITIES = ["七年級導師", "八年級導師", "九年級導師", "專任教師", "行政"] as const;
export type UserIdentity = (typeof USER_IDENTITIES)[number];

export interface ImportantEvent { date: string; time?: string; endDate?: string; endTime?: string; title: string }
export interface Deadline { date: string; time?: string; label: string }
export interface ImageAttachment { id: string; type: "image"; url: string; name: string; caption?: string }
export interface PdfAttachment {
  id: string;
  type: "pdf";
  url: string;
  name: string;
  sizeBytes: number;
  storagePath: string;
  contentType: "application/pdf";
}
export type Attachment = ImageAttachment | PdfAttachment;
export interface FollowUp {
  id?: string;
  createdAt: string;
  updatedAt?: string;
  type: "supplement" | "reminder" | "related";
  message: string;
  authorUid?: string;
  department?: string;
  authorDisplayName?: string;
  status?: "active" | "withdrawn";
  withdrawnAt?: string;
  withdrawnBy?: string;
}
export interface LatestFollowUpSummary {
  type: "supplement" | "reminder";
  createdAt: string;
}
export interface FollowUpCounts { supplement: number; reminder: number; related: number }
export interface AnnouncementLink { id: string; label: string; url: string; type: "website"; isPrimary: boolean }
export const LINE_NOTIFICATION_LEVELS = ["schoolwide", "required", "task", "general"] as const;
export type LineNotificationLevel = (typeof LINE_NOTIFICATION_LEVELS)[number];
export const DEFAULT_LINE_NOTIFICATION_LEVEL: LineNotificationLevel = "general";
export const LINE_NOTIFICATION_LEVEL_LABELS: Record<LineNotificationLevel, string> = {
  schoolwide: "🚨【全校必讀】",
  required: "🔴【重要必讀】",
  task: "🟠【待辦事項】",
  general: "🔵【一般公告】",
};
export const LINE_NOTIFICATION_LEVEL_DESCRIPTIONS: Record<LineNotificationLevel, string> = {
  schoolwide: "全校同仁都必須閱讀",
  required: "相關同仁務必詳閱",
  task: "需要完成繳交、填報或設定",
  general: "一般資訊周知",
};
export const MAX_AUDIENCE_NOTE_LENGTH = 40;

export function isLineNotificationLevel(value: unknown): value is LineNotificationLevel {
  return typeof value === "string" && LINE_NOTIFICATION_LEVELS.includes(value as LineNotificationLevel);
}

/** 舊公告沒有通知等級時，一律視為一般公告；不做歷史資料遷移。 */
export function resolveLineNotificationLevel(value: unknown): LineNotificationLevel {
  return isLineNotificationLevel(value) ? value : DEFAULT_LINE_NOTIFICATION_LEVEL;
}

export function normalizeAudienceNote(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized : undefined;
}

export function validateAudienceNote(value: unknown) {
  const normalized = normalizeAudienceNote(value);
  return normalized && normalized.length > MAX_AUDIENCE_NOTE_LENGTH ? `實際辦理對象不可超過 ${MAX_AUDIENCE_NOTE_LENGTH} 個字` : undefined;
}

/** 選擇「全校必讀」但接收對象不是全校教師時，只提醒、不阻止發布。 */
export function needsSchoolwideAudienceReminder(level: LineNotificationLevel | undefined, audiences: readonly Audience[]) {
  return level === "schoolwide" && !(audiences.length === 1 && audiences[0] === "全校教師");
}

export interface Announcement {
  id: string;
  publisherUid?: string;
  publisherEmail?: string;
  publisherDisplayName?: string;
  publicationStatus?: "published" | "withdrawn";
  withdrawnAt?: string;
  withdrawnBy?: string;
  collectionStatus?: "chasing";
  collectionMessage?: string;
  collectionStartedAt?: string;
  collectionStartedBy?: string;
  updatedAt?: string;
  contentUpdatedAt?: string;
  contentUpdateCount?: number;
  latestFollowUp?: LatestFollowUpSummary;
  followUpCounts?: FollowUpCounts;
  hasRelatedFollowUp?: boolean;
  academicYear: number;
  publishedAt: string;
  department: Department;
  title: string;
  audiences: Audience[];
  /** 僅影響 LINE 通知呈現，不影響公告接收身分。 */
  lineNotificationLevel?: LineNotificationLevel;
  /** 實際辦理對象（選填），僅供 LINE 通知顯示，不影響 audiences 篩選。 */
  audienceNote?: string;
  content: string;
  contact?: AnnouncementContact;
  importantEvents: ImportantEvent[];
  deadlines: Deadline[];
  attachments: Attachment[];
  followUps: FollowUp[];
  links: AnnouncementLink[];
}

export function normalizeAudiences(values: readonly Audience[]): Audience[] {
  const unique = [...new Set(values)];
  return unique.includes("全校教師") ? ["全校教師"] : unique;
}

export function toggleAudienceSelection(values: readonly Audience[], audience: Audience, checked: boolean): Audience[] {
  if (!checked) return values.filter(value => value !== audience);
  if (audience === "全校教師") return ["全校教師"];
  return [...values.filter(value => value !== "全校教師" && value !== audience), audience];
}

export function formatFollowUpType(type: FollowUp["type"]) {
  return type === "supplement" ? "補充" : type === "reminder" ? "提醒" : "相關補充";
}

export function formatLatestFollowUpLabel(type: FollowUp["type"]) {
  return `最新${formatFollowUpType(type)}`;
}

export function isImportantEventUsed(event: ImportantEvent) {
  return Boolean(event.date || event.title.trim());
}

export function normalizeImportantEvent(event: ImportantEvent): ImportantEvent {
  if (!isImportantEventUsed(event)) return { date: "", title: "" };
  return {
    date: event.date,
    ...(event.time ? { time: event.time } : {}),
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.endTime ? { endTime: event.endTime } : {}),
    title: event.title,
  };
}

export function formatImportantEventSchedule(event: ImportantEvent, formatDate: (date: string) => string = value => value) {
  const start = `${formatDate(event.date)}${event.time ? ` ${event.time}` : ""}`;
  if (!event.endDate && !event.endTime) return start;
  const sameDay = !event.endDate || event.endDate === event.date;
  if (sameDay && event.time && event.endTime) return `${start}－${event.endTime}`;
  const end = `${event.endDate ? formatDate(event.endDate) : ""}${event.endTime ? `${event.endDate ? " " : ""}${event.endTime}` : ""}`;
  return `${start} ～ ${end}`;
}
