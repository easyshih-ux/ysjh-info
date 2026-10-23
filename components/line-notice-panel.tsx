"use client";

import { useEffect, useRef, useState } from "react";
import type { Announcement, FollowUp } from "@/lib/announcements";
import { readManagedAnnouncements } from "@/lib/announcementFirestore";
import { readAnnouncementFollowUps } from "@/lib/announcementFollowUps";
import { lineNoticeText, pendingLineNotices, type LineNotice } from "@/lib/lineNotices";
import { readPendingLineNotices } from "@/lib/lineNoticesFirestore";
import { getPublicSiteUrl } from "@/lib/siteUrl";
import { taipeiDateKey } from "@/lib/taipeiDate";
import type { AuthorizedPublisherContextValue } from "@/lib/publisherAccess";
import { LineNoticeCard } from "@/components/line-notice-card";
import styles from "./line-notice-panel.module.css";

type Row = { notice: LineNotice; announcement: Announcement; text: string };

/** 行政管理首頁「LINE 待通知」：複製不等於已發送，按「我已發送 LINE」後才退出清單。 */
export function LineNoticePanel({ publisher }: { publisher: Pick<AuthorizedPublisherContextValue, "uid" | "role"> }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // 從「稍後再發／前往 LINE 待通知」連過來時，捲到這個區塊。
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !rows || window.location.hash !== "#line-notices") return;
    scrolledRef.current = true;
    document.getElementById("line-notices")?.scrollIntoView({ block: "start" });
  }, [rows]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [notices, announcements] = await Promise.all([readPendingLineNotices(publisher), readManagedAnnouncements()]);
      const followUpIds = [...new Set(notices.filter(item => item.type === "supplement" || item.type === "reminder").map(item => item.announcementId))];
      const followUps: Record<string, FollowUp[]> = Object.fromEntries(await Promise.all(followUpIds.map(async id => [id, await readAnnouncementFollowUps(id).catch(() => [])] as const)));
      const byId = new Map(announcements.map(item => [item.id, item]));
      const siteUrl = getPublicSiteUrl(window.location.origin);
      const today = taipeiDateKey(new Date());
      return pendingLineNotices(notices, announcements, followUps).map(notice => {
        const announcement = byId.get(notice.announcementId)!;
        return { notice, announcement, text: lineNoticeText(notice, announcement, siteUrl, today) };
      });
    })().then(value => { if (active) setRows(value); }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [publisher.uid, publisher.role]);

  const key = (notice: LineNotice) => `${notice.announcementId}/${notice.id}`;
  const remove = (row: Row) => setRows(current => current?.filter(item => key(item.notice) !== key(row.notice)) ?? null);

  // 即使沒有待辦也顯示區塊，讓行政人員知道「LINE 待通知」在這裡。
  return <section id="line-notices" className={styles.panel} aria-labelledby="line-notice-title">
    <h2 id="line-notice-title">📨 LINE 待通知{rows && rows.length > 0 ? `（${rows.length}）` : ""}</h2>
    {loadError ? <p className={styles.error} role="alert">待通知清單暫時無法載入，請稍後再試。</p>
      : !rows ? <p className={styles.empty}>讀取中…</p>
      : rows.length === 0 ? <p className={styles.empty}>目前沒有待發送的 LINE 通知。</p>
      : <>
        <p className={styles.hint}>複製後請到 LINE 群組貼上並送出；送出後再按「我已發送 LINE」。</p>
        {rows.map(row => <LineNoticeCard key={key(row.notice)} uid={publisher.uid} onSent={() => remove(row)}
          notice={{ announcementId: row.notice.announcementId, id: row.notice.id, type: row.notice.type, title: row.announcement.title, text: row.text }} />)}
      </>}
  </section>;
}
