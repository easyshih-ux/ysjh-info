import { collection, getDocs } from "firebase/firestore";
import { ANNOUNCEMENTS_COLLECTION, getFirestoreClient } from "./firestoreClient.ts";
import { AUDIENCES, normalizeAudiences, type Announcement, type AnnouncementLink, type Attachment, type Audience, type Deadline, type FollowUp, type ImportantEvent } from "./announcements.ts";
import { isDepartment } from "./departments.ts";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isDateTime = (value: unknown): value is string => isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
const isDateOnly = (value: unknown): value is string => isNonEmptyString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
const records = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : [];

function normalizeImportantEvents(value: unknown): ImportantEvent[] {
  return records(value).flatMap(item => isDateOnly(item.date) && isNonEmptyString(item.title)
    ? [{ date: item.date, ...(isNonEmptyString(item.time) ? { time: item.time } : {}), ...(isDateOnly(item.endDate) ? { endDate: item.endDate } : {}), ...(isNonEmptyString(item.endTime) ? { endTime: item.endTime } : {}), title: item.title }]
    : []);
}

function normalizeDeadlines(value: unknown): Deadline[] {
  return records(value).flatMap(item => isDateOnly(item.date) && isNonEmptyString(item.label)
    ? [{ date: item.date, ...(isNonEmptyString(item.time) ? { time: item.time } : {}), label: item.label }]
    : []);
}

function normalizeAttachments(value: unknown): Attachment[] {
  return records(value).flatMap(item => isNonEmptyString(item.id) && item.type === "image" && isNonEmptyString(item.url) && item.url.startsWith("https://") && isNonEmptyString(item.name)
    ? [{ id: item.id, type: "image" as const, url: item.url, name: item.name, ...(isNonEmptyString(item.caption) ? { caption: item.caption } : {}) }]
    : []);
}

function normalizeLinks(value: unknown): AnnouncementLink[] {
  return records(value).flatMap(item => isNonEmptyString(item.id) && isNonEmptyString(item.label) && isNonEmptyString(item.url) && item.type === "website"
    ? [{ id: item.id, label: item.label, url: item.url, type: "website" as const, isPrimary: item.isPrimary === true }]
    : []);
}

function normalizeFollowUps(value: unknown): FollowUp[] {
  return records(value).flatMap(item => isDateTime(item.createdAt) && (item.type === "supplement" || item.type === "reminder") && isNonEmptyString(item.message)
    ? [{ createdAt: item.createdAt, type: item.type, message: item.message }]
    : []);
}

export function announcementFromFirestore(id: string, value: unknown): Announcement | null {
  if (!isRecord(value) || !isNonEmptyString(id) || !Number.isInteger(value.academicYear) || !isDateTime(value.publishedAt) || !isDepartment(value.department) || !isNonEmptyString(value.title) || !isString(value.content)) return null;

  const audiences = Array.isArray(value.audiences)
    ? value.audiences.filter((audience): audience is Audience => AUDIENCES.includes(audience as Audience))
    : [];

  return {
    id,
    academicYear: value.academicYear as number,
    publishedAt: value.publishedAt,
    ...(isNonEmptyString(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
    department: value.department,
    title: value.title,
    audiences: normalizeAudiences(audiences),
    content: value.content,
    importantEvents: normalizeImportantEvents(value.importantEvents),
    deadlines: normalizeDeadlines(value.deadlines),
    attachments: normalizeAttachments(value.attachments),
    links: normalizeLinks(value.links),
    followUps: normalizeFollowUps(value.followUps),
  };
}

export function sortAnnouncementsNewestFirst(announcements: Announcement[]) {
  return [...announcements].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function readPublicAnnouncements(): Promise<Announcement[]> {
  const snapshot = await getDocs(collection(getFirestoreClient(), ANNOUNCEMENTS_COLLECTION));
  const announcements = snapshot.docs.flatMap(document => {
    const announcement = announcementFromFirestore(document.id, document.data());
    return announcement ? [announcement] : [];
  });
  return sortAnnouncementsNewestFirst(announcements);
}
