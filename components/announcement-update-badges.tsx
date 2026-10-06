import { formatLatestFollowUpLabel, type Announcement } from "@/lib/announcements";
import { announcementUpdateStatus } from "@/lib/announcementUpdateStatus";

export function AnnouncementUpdateBadges({ announcement, className }: { announcement: Announcement; className?: string }) {
  const status = announcementUpdateStatus(announcement);
  if (!status.hasContentUpdate && !status.latestFollowUp && !status.hasRelatedFollowUp) return null;
  return <div className={className ?? "announcement-badges"}>
    {status.hasContentUpdate && <span className="content-update-badge">✎ 公告有更新</span>}
    {status.latestFollowUp && <span className="followup-badge">⚠ 有{formatLatestFollowUpLabel(status.latestFollowUp.type)}</span>}
    {status.hasRelatedFollowUp && <span className="related-followup-badge">💬 有其他單位補充</span>}
  </div>;
}
