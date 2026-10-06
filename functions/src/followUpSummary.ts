import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";

type FollowUpSnapshotData = Record<string, unknown> | undefined;

export interface FollowUpSummaryChange {
  announcementId: string;
  before: FollowUpSnapshotData;
  after: FollowUpSnapshotData;
}

type TimestampLike = { toMillis: () => number };
type FollowUpType = "supplement" | "reminder" | "related";
type FollowUpCounts = Record<FollowUpType, number>;

function isOriginalFollowUp(value: FollowUpSnapshotData) {
  return value?.type === "supplement" || value?.type === "reminder";
}

function timestampMillis(value: unknown) {
  return typeof value === "object" && value !== null && "toMillis" in value && typeof (value as TimestampLike).toMillis === "function"
    ? (value as TimestampLike).toMillis()
    : -1;
}

function legacyCount(value: unknown, type: FollowUpType) {
  return Array.isArray(value) ? value.filter(item => typeof item === "object" && item !== null && (item as Record<string, unknown>).type === type).length : 0;
}

function isActive(value: Record<string, unknown>, type: FollowUpType) {
  return type === "related" || value.status !== "withdrawn";
}

async function countFollowUps(announcementRef: DocumentReference, legacy: unknown) {
  const types: FollowUpType[] = ["supplement", "reminder", "related"];
  const counts = await Promise.all(types.map(async type => {
    const snapshot = await announcementRef.collection("followUps").where("type", "==", type).get();
    return [type, (snapshot.docs ? snapshot.docs.filter(item => isActive(item.data(), type)).length : snapshot.size) + legacyCount(legacy, type)] as const;
  }));
  return Object.fromEntries(counts) as FollowUpCounts;
}

async function latestActiveFollowUp(announcementRef: DocumentReference, legacy: unknown, changed?: FollowUpSnapshotData) {
  const candidates: { type: "supplement" | "reminder"; createdAt: unknown }[] = [];
  for (const type of ["supplement", "reminder"] as const) {
    const snapshot = await announcementRef.collection("followUps").where("type", "==", type).get();
    (snapshot.docs ?? []).forEach(item => { const data = item.data(); if (isActive(data, type) && timestampMillis(data.createdAt) >= 0) candidates.push({ type, createdAt: data.createdAt }); });
    if (Array.isArray(legacy)) legacy.forEach(item => {
      if (typeof item === "object" && item !== null && (item as Record<string, unknown>).type === type && timestampMillis((item as Record<string, unknown>).createdAt) >= 0) candidates.push({ type, createdAt: (item as Record<string, unknown>).createdAt });
    });
  }
  if (changed && (changed.type === "supplement" || changed.type === "reminder") && isActive(changed, changed.type) && timestampMillis(changed.createdAt) >= 0) candidates.push({ type: changed.type, createdAt: changed.createdAt });
  return candidates.sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))[0];
}

export async function syncFollowUpSummaryChange(
  change: FollowUpSummaryChange,
  firestore: Firestore,
) {
  const wasOriginal = isOriginalFollowUp(change.before);
  const isOriginal = isOriginalFollowUp(change.after);
  const wasRelated = change.before?.type === "related";
  const isRelated = change.after?.type === "related";

  if ((!wasOriginal && !isOriginal) && (!wasRelated && !isRelated)) {
    return { updated: false, reason: "irrelevant-change" as const };
  }

  const announcementRef = firestore.collection("announcements").doc(change.announcementId);
  const announcement = await announcementRef.get();
  if (!announcement.exists) return { updated: false, reason: "announcement-missing" as const };

  const data = announcement.data() ?? {};
  const patch: Record<string, unknown> = {};

  const counts = await countFollowUps(announcementRef, data.followUps);
  const currentCounts = data.followUpCounts as FollowUpCounts | undefined;
  if (!currentCounts || ["supplement", "reminder", "related"].some(type => currentCounts[type as FollowUpType] !== counts[type as FollowUpType])) {
    patch.followUpCounts = counts;
  }
  if (data.hasRelatedFollowUp !== (counts.related > 0)) patch.hasRelatedFollowUp = counts.related > 0;

  if (wasOriginal || isOriginal) {
    const latest = await latestActiveFollowUp(announcementRef, data.followUps, change.after);
    const current = data.latestFollowUp as Record<string, unknown> | undefined;
    if (latest && (current?.type !== latest.type || timestampMillis(current.createdAt) !== timestampMillis(latest.createdAt))) patch.latestFollowUp = latest;
    if (!latest && current) patch.latestFollowUp = FieldValue.delete();
  }

  if (Object.keys(patch).length === 0) {
    return {
      updated: false,
      reason: "already-current" as const,
      ...((wasRelated || isRelated) ? { hasRelatedFollowUp: data.hasRelatedFollowUp === true } : {}),
    };
  }
  await announcementRef.update(patch);
  return { updated: true, ...patch };
}
