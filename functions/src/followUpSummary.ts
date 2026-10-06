import type { Firestore } from "firebase-admin/firestore";

type FollowUpSnapshotData = Record<string, unknown> | undefined;

export interface FollowUpSummaryChange {
  announcementId: string;
  before: FollowUpSnapshotData;
  after: FollowUpSnapshotData;
}

type TimestampLike = { toMillis: () => number };

function isOriginalFollowUp(value: FollowUpSnapshotData) {
  return value?.type === "supplement" || value?.type === "reminder";
}

function timestampMillis(value: unknown) {
  return typeof value === "object" && value !== null && "toMillis" in value && typeof (value as TimestampLike).toMillis === "function"
    ? (value as TimestampLike).toMillis()
    : -1;
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

  const currentFollowUp = change.after;
  if (isOriginal && currentFollowUp && currentFollowUp.type !== change.before?.type && timestampMillis(currentFollowUp.createdAt) >= 0) {
    const current = data.latestFollowUp as Record<string, unknown> | undefined;
    if (timestampMillis(currentFollowUp.createdAt) >= timestampMillis(current?.createdAt)) {
      patch.latestFollowUp = { type: currentFollowUp.type, createdAt: currentFollowUp.createdAt };
    }
  }

  if ((wasRelated && !isRelated) || (!wasRelated && isRelated)) {
    let hasRelatedFollowUp = true;
    if (wasRelated && !isRelated) {
      const remaining = await announcementRef.collection("followUps")
        .where("type", "==", "related")
        .limit(1)
        .get();
      hasRelatedFollowUp = !remaining.empty;
    }
    if (data.hasRelatedFollowUp !== hasRelatedFollowUp) patch.hasRelatedFollowUp = hasRelatedFollowUp;
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

export async function syncRelatedFollowUpSummaryChange(
  change: FollowUpSummaryChange,
  firestore: Firestore,
) {
  return syncFollowUpSummaryChange(change, firestore);
}
