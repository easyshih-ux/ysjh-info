"use client";

import { useEffect, useState } from "react";
import type { Announcement, FollowUp } from "@/lib/announcements";
import { readManagedAnnouncements } from "@/lib/announcementFirestore";
import { readAnnouncementFollowUps } from "@/lib/announcementFollowUps";
import { copyLineAnnouncement } from "@/lib/lineAnnouncementSummary";
import { LINE_NOTICE_TYPE_LABELS, lineNoticeText, pendingLineNotices, type LineNotice } from "@/lib/lineNotices";
import { confirmLineNoticeSent, readPendingLineNotices } from "@/lib/lineNoticesFirestore";
import { getPublicSiteUrl } from "@/lib/siteUrl";
import { taipeiDateKey } from "@/lib/taipeiDate";
import type { AuthorizedPublisherContextValue } from "@/lib/publisherAccess";
import { Button } from "@/components/ui/button";
import styles from "./line-notice-panel.module.css";

type Row = { notice: LineNotice; announcement: Announcement; text: string };

/** 行政管理首頁「LINE 待通知」：複製不等於已發送，按「我已發送 LINE」後才退出清單。 */
export function LineNoticePanel({ publisher }: { publisher: Pick<AuthorizedPublisherContextValue, "uid" | "role"> }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

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
  const copy = async (row: Row) => {
    const ok = await copyLineAnnouncement(row.text);
    setStatus(current => ({ ...current, [key(row.notice)]: ok ? "已複製。請到 LINE 群組貼上並送出，完成後按「我已發送 LINE」。" : "複製失敗，請手動選取上方文字複製。" }));
  };
  const confirmSent = async (row: Row) => {
    if (busy) return;
    setBusy(key(row.notice));
    try {
      await confirmLineNoticeSent(row.notice, publisher.uid);
      setRows(current => current?.filter(item => key(item.notice) !== key(row.notice)) ?? null);
    } catch {
      setStatus(current => ({ ...current, [key(row.notice)]: "確認失敗，可能已由其他行政人員確認，請重新整理後再試。" }));
    } finally { setBusy(null); }
  };

  if (loadError) return <section className={styles.panel} aria-labelledby="line-notice-title"><h2 id="line-notice-title">📨 LINE 待通知</h2><p className={styles.error} role="alert">待通知清單暫時無法載入，請稍後再試。</p></section>;
  if (!rows || rows.length === 0) return null;
  return <section className={styles.panel} aria-labelledby="line-notice-title">
    <h2 id="line-notice-title">📨 LINE 待通知（{rows.length}）</h2>
    <p className={styles.hint}>複製後請到 LINE 群組貼上並送出；送出後再按「我已發送 LINE」。</p>
    {rows.map(row => <article key={key(row.notice)} className={styles.item}>
      <div className={styles.meta}><span className={styles.type}>{LINE_NOTICE_TYPE_LABELS[row.notice.type]}</span><strong>{row.announcement.title}</strong></div>
      <pre tabIndex={0}>{row.text}</pre>
      <div className={styles.actions}><Button type="button" variant="outline" onClick={() => void copy(row)}>複製 LINE</Button><Button type="button" onClick={() => void confirmSent(row)} disabled={busy === key(row.notice)}>{busy === key(row.notice) ? "確認中…" : "我已發送 LINE"}</Button></div>
      {status[key(row.notice)] && <p className={styles.status} role="status">{status[key(row.notice)]}</p>}
    </article>)}
  </section>;
}
