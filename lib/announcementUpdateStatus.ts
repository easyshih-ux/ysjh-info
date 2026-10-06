import { type Announcement, type FollowUpCounts, type LatestFollowUpSummary } from "./announcements.ts";

function legacyCounts(announcement: Announcement): FollowUpCounts | undefined {
  if (!announcement.followUps.length) return undefined;
  return announcement.followUps
    .filter(value => value.status !== "withdrawn")
    .reduce<FollowUpCounts>((counts, value) => ({ ...counts, [value.type]: counts[value.type] + 1 }), { supplement: 0, reminder: 0, related: 0 });
}

function latestLegacyFollowUp(announcement: Announcement): LatestFollowUpSummary | undefined {
  const latest = announcement.followUps
    .filter(value => (value.type === "supplement" || value.type === "reminder") && value.status !== "withdrawn")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest ? { type: latest.type === "supplement" ? "supplement" : "reminder", createdAt: latest.createdAt } : undefined;
}

export function latestFollowUpForHomepage(announcement: Announcement) {
  return announcement.latestFollowUp ?? latestLegacyFollowUp(announcement);
}

export function announcementUpdateStatus(announcement: Announcement) {
  const counts = announcement.followUpCounts ?? legacyCounts(announcement);
  return {
    hasContentUpdate: Boolean(announcement.contentUpdatedAt),
    contentUpdateCount: announcement.contentUpdateCount,
    latestFollowUp: latestFollowUpForHomepage(announcement),
    followUpCounts: counts,
    hasRelatedFollowUp: (counts?.related ?? 0) > 0 || announcement.hasRelatedFollowUp === true,
  };
}
