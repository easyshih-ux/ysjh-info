import { collection, getDocs } from "firebase/firestore";
import { ANNOUNCEMENTS_COLLECTION, getFirestoreClient } from "./firestoreClient.ts";
import { AUDIENCES, normalizeAudiences, type Announcement, type AnnouncementLink, type Attachment, type Audience, type Deadline, type FollowUp, type ImportantEvent } from "./announcements.ts";
import { MAX_ATTACHMENT_NAME_LENGTH, MAX_PDF_BYTES } from "./attachmentFiles.ts";
import { isDepartment } from "./departments.ts";
import { MAX_CONTACT_EXTENSION_LENGTH, type AnnouncementContact } from "./departmentContacts.ts";

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
  const attachments: Attachment[] = [];
  for (const item of records(value)) {
    if (!isNonEmptyString(item.id) || !isNonEmptyString(item.url) || !item.url.startsWith("https://") || !isNonEmptyString(item.name)) continue;
    if (item.type === "image") {
      attachments.push({ id: item.id, type: "image", url: item.url, name: item.name, ...(isNonEmptyString(item.caption) ? { caption: item.caption } : {}) });
      continue;
    }
    if (item.type === "pdf"
      && item.name.length <= MAX_ATTACHMENT_NAME_LENGTH
      && typeof item.sizeBytes === "number" && Number.isInteger(item.sizeBytes) && item.sizeBytes > 0 && item.sizeBytes <= MAX_PDF_BYTES
      && isNonEmptyString(item.storagePath)
      && item.contentType === "application/pdf") {
      attachments.push({
        id: item.id,
        type: "pdf" as const,
        url: item.url,
        name: item.name,
        sizeBytes: item.sizeBytes,
        storagePath: item.storagePath,
        contentType: "application/pdf" as const,
      });
    }
  }
  return attachments;
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

function normalizeContact(value: unknown): AnnouncementContact | undefined {
  if (!isRecord(value)
    || !isNonEmptyString(value.department)
    || value.department.trim().length > 30
    || !isNonEmptyString(value.extension)
    || !new RegExp(`^\\d{2,${MAX_CONTACT_EXTENSION_LENGTH}}$`).test(value.extension)
    || Object.keys(value).some(key => key !== "department" && key !== "extension")) return undefined;
  return { department: value.department.trim(), extension: value.extension };
}

export function announcementFromFirestore(id: string, value: unknown): Announcement | null {
  if (!isRecord(value) || !isNonEmptyString(id) || !Number.isInteger(value.academicYear) || !isDateTime(value.publishedAt) || !isDepartment(value.department) || !isNonEmptyString(value.title) || !isString(value.content)) return null;

  const audiences = Array.isArray(value.audiences)
    ? value.audiences.filter((audience): audience is Audience => AUDIENCES.includes(audience as Audience))
    : [];

  return {
    id,
    ...(isNonEmptyString(value.publisherUid) ? { publisherUid: value.publisherUid } : {}),
    ...(isNonEmptyString(value.publisherEmail) ? { publisherEmail: value.publisherEmail } : {}),
    ...(isNonEmptyString(value.publisherDisplayName) ? { publisherDisplayName: value.publisherDisplayName } : {}),
    ...(value.publicationStatus === "withdrawn" ? { publicationStatus: "withdrawn" as const } : value.publicationStatus === "published" ? { publicationStatus: "published" as const } : {}),
    ...(isDateTime(value.withdrawnAt) ? { withdrawnAt: value.withdrawnAt } : {}),
    ...(isNonEmptyString(value.withdrawnBy) ? { withdrawnBy: value.withdrawnBy } : {}),
    ...(value.collectionStatus === "chasing" ? { collectionStatus: "chasing" as const } : {}),
    ...(isString(value.collectionMessage) ? { collectionMessage: value.collectionMessage } : {}),
    ...(isDateTime(value.collectionStartedAt) ? { collectionStartedAt: value.collectionStartedAt } : {}),
    ...(isNonEmptyString(value.collectionStartedBy) ? { collectionStartedBy: value.collectionStartedBy } : {}),
    academicYear: value.academicYear as number,
    publishedAt: value.publishedAt,
    ...(isNonEmptyString(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
    ...(isDateTime(value.contentUpdatedAt) ? { contentUpdatedAt: value.contentUpdatedAt } : {}),
    ...(value.hasRelatedFollowUp === true ? { hasRelatedFollowUp: true } : {}),
    department: value.department,
    title: value.title,
    audiences: normalizeAudiences(audiences),
    content: value.content,
    ...(normalizeContact(value.contact) ? { contact: normalizeContact(value.contact) } : {}),
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
    return announcement && announcement.publicationStatus !== "withdrawn" ? [announcement] : [];
  });
  return sortAnnouncementsNewestFirst(announcements);
}

export async function readManagedAnnouncements(): Promise<Announcement[]> {
  const snapshot = await getDocs(collection(getFirestoreClient(), ANNOUNCEMENTS_COLLECTION));
  return sortAnnouncementsNewestFirst(snapshot.docs.flatMap(document => {
    const announcement = announcementFromFirestore(document.id, document.data());
    return announcement ? [announcement] : [];
  }));
}
