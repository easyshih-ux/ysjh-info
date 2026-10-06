import { type Announcement, type LatestFollowUpSummary } from "./announcements.ts";

function latestLegacyFollowUp(announcement: Announcement): LatestFollowUpSummary | undefined {
  const latest = announcement.followUps
    .filter(value => value.type === "supplement" || value.type === "reminder")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest ? { type: latest.type === "supplement" ? "supplement" : "reminder", createdAt: latest.createdAt } : undefined;
}

export function latestFollowUpForHomepage(announcement: Announcement) {
  return announcement.latestFollowUp ?? latestLegacyFollowUp(announcement);
}

export function announcementUpdateStatus(announcement: Announcement) {
  return {
    hasContentUpdate: Boolean(announcement.contentUpdatedAt),
    latestFollowUp: latestFollowUpForHomepage(announcement),
    hasRelatedFollowUp: announcement.hasRelatedFollowUp === true,
  };
}
