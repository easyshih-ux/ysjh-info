import type { Firestore } from "firebase-admin/firestore";

type FollowUpSnapshotData = Record<string, unknown> | undefined;

export interface FollowUpSummaryChange {
  announcementId: string;
  before: FollowUpSnapshotData;
  after: FollowUpSnapshotData;
}

export async function syncRelatedFollowUpSummaryChange(
  change: FollowUpSummaryChange,
  firestore: Firestore,
) {
  const wasRelated = change.before?.type === "related";
  const isRelated = change.after?.type === "related";

  if ((!wasRelated && !isRelated) || (wasRelated && isRelated)) {
    return { updated: false, reason: "irrelevant-change" as const };
  }

  const announcementRef = firestore.collection("announcements").doc(change.announcementId);
  const announcement = await announcementRef.get();
  if (!announcement.exists) {
    return { updated: false, reason: "announcement-missing" as const };
  }

  let hasRelatedFollowUp = true;
  if (wasRelated && !isRelated) {
    const remaining = await announcementRef.collection("followUps")
      .where("type", "==", "related")
      .limit(1)
      .get();
    hasRelatedFollowUp = !remaining.empty;
  }

  if (announcement.data()?.hasRelatedFollowUp === hasRelatedFollowUp) {
    return { updated: false, reason: "already-current" as const, hasRelatedFollowUp };
  }

  await announcementRef.update({ hasRelatedFollowUp });
  return { updated: true, hasRelatedFollowUp };
}
