"use client";

import { useMemo, useState } from "react";
import type { Announcement } from "@/lib/announcements";
import { copyLineAnnouncement, createLineAnnouncementSummary } from "@/lib/lineAnnouncementSummary";
import { getPublicSiteUrl } from "@/lib/siteUrl";
import { Button } from "@/components/ui/button";
import styles from "./line-summary-card.module.css";

export function LineSummaryCard({ announcement }: { announcement: Announcement }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");
  const summary = useMemo(() => createLineAnnouncementSummary(announcement, getPublicSiteUrl(typeof window === "undefined" ? undefined : window.location.origin)), [announcement]);
  const copy = async () => setCopyStatus(await copyLineAnnouncement(summary) ? "success" : "error");

  return <section className={styles.card} aria-labelledby={`line-summary-${announcement.id}`}>
    <h2 id={`line-summary-${announcement.id}`}>LINE 公告摘要</h2>
    <pre tabIndex={0}>{summary}</pre>
    <div className={styles.actions}><Button type="button" onClick={copy}>複製 LINE 公告</Button>{copyStatus === "success" && <p role="status">已複製，可直接貼到 LINE 群組。</p>}{copyStatus === "error" && <p className={styles.error} role="alert">複製失敗，請手動選取文字複製。</p>}</div>
  </section>;
}
