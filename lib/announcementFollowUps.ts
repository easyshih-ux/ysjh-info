import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc, type Timestamp } from "firebase/firestore";
import type { FollowUp } from "./announcements.ts";
import { ANNOUNCEMENTS_COLLECTION, getFirestoreClient } from "./firestoreClient.ts";

export const FOLLOW_UPS_SUBCOLLECTION = "followUps";

type FollowUpAuthor = {
  uid: string;
  defaultDepartment: string;
  displayName: string | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is Timestamp {
  return isRecord(value) && typeof value.toDate === "function";
}

export function followUpFromFirestore(id: string, value: unknown): FollowUp | null {
  if (!isRecord(value)
    || (value.type !== "supplement" && value.type !== "reminder" && value.type !== "related")
    || typeof value.message !== "string" || !value.message.trim()
    || typeof value.authorUid !== "string" || !value.authorUid.trim()
    || typeof value.department !== "string" || !value.department.trim()
    || !isTimestamp(value.createdAt)) return null;

  return {
    id,
    type: value.type,
    message: value.message.trim(),
    authorUid: value.authorUid,
    department: value.department,
    ...(typeof value.authorDisplayName === "string" && value.authorDisplayName.trim()
      ? { authorDisplayName: value.authorDisplayName.trim() }
      : {}),
    createdAt: value.createdAt.toDate().toISOString(),
    ...(isTimestamp(value.updatedAt) ? { updatedAt: value.updatedAt.toDate().toISOString() } : {}),
  };
}

export function mergeAnnouncementFollowUps(legacy: readonly FollowUp[], current: readonly FollowUp[]) {
  const currentIds = new Set(current.flatMap(item => item.id ? [item.id] : []));
  return [...legacy.filter(item => !item.id || !currentIds.has(item.id)), ...current]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function followUpsCollection(announcementId: string) {
  return collection(getFirestoreClient(), ANNOUNCEMENTS_COLLECTION, announcementId, FOLLOW_UPS_SUBCOLLECTION);
}

export async function readAnnouncementFollowUps(announcementId: string) {
  const snapshot = await getDocs(query(followUpsCollection(announcementId), orderBy("createdAt", "desc")));
  return snapshot.docs.flatMap(item => {
    const followUp = followUpFromFirestore(item.id, item.data());
    return followUp ? [followUp] : [];
  });
}

export async function createAnnouncementFollowUp(
  announcementId: string,
  type: FollowUp["type"],
  message: string,
  author: FollowUpAuthor,
) {
  const reference = doc(followUpsCollection(announcementId));
  const displayName = author.displayName;
  await setDoc(reference, {
    type,
    message: message.trim(),
    authorUid: author.uid,
    department: author.defaultDepartment,
    ...(typeof displayName === "string" && displayName.trim() === displayName && displayName
      ? { authorDisplayName: displayName }
      : {}),
    createdAt: serverTimestamp(),
  });
  const snapshot = await getDoc(reference);
  const followUp = followUpFromFirestore(snapshot.id, snapshot.data());
  if (!followUp) throw new Error("Invalid follow-up response");
  return followUp;
}

export async function updateRelatedFollowUp(announcementId: string, followUpId: string, message: string) {
  const reference = doc(followUpsCollection(announcementId), followUpId);
  await updateDoc(reference, { message: message.trim(), updatedAt: serverTimestamp() });
  const snapshot = await getDoc(reference);
  const followUp = followUpFromFirestore(snapshot.id, snapshot.data());
  if (!followUp) throw new Error("Invalid related follow-up response");
  return followUp;
}

export async function deleteRelatedFollowUp(announcementId: string, followUpId: string) {
  await deleteDoc(doc(followUpsCollection(announcementId), followUpId));
}
