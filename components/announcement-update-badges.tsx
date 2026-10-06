import { type Announcement } from "@/lib/announcements";
import { announcementUpdateStatus } from "@/lib/announcementUpdateStatus";

export function AnnouncementUpdateBadges({ announcement, className }: { announcement: Announcement; className?: string }) {
  const status = announcementUpdateStatus(announcement);
  const counts = status.followUpCounts;
  const fallbackSupplement = !counts && status.latestFollowUp?.type === "supplement";
  const fallbackReminder = !counts && status.latestFollowUp?.type === "reminder";
  if (!status.hasContentUpdate && !counts && !status.latestFollowUp && !status.hasRelatedFollowUp) return null;
  return <div className={className ?? "announcement-badges"}>
    {status.hasContentUpdate && <span className="content-update-badge">✎ {status.contentUpdateCount ? `公告修正 ${status.contentUpdateCount} 次` : "公告有更新"}</span>}
    {(counts?.supplement ?? 0) > 0 && <span className="supplement-badge">📌 補充 {counts!.supplement} 則</span>}
    {fallbackSupplement && <span className="supplement-badge">📌 有最新補充</span>}
    {(counts?.reminder ?? 0) > 0 && <span className="followup-badge">⚠ 提醒 {counts!.reminder} 次</span>}
    {fallbackReminder && <span className="followup-badge">⚠ 有最新提醒</span>}
    {(counts?.related ?? 0) > 0 ? <span className="related-followup-badge">💬 其他單位補充 {counts!.related} 則</span> : status.hasRelatedFollowUp && <span className="related-followup-badge">💬 有其他單位補充</span>}
  </div>;
}
