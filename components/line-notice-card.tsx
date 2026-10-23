"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { copyLineAnnouncement } from "@/lib/lineAnnouncementSummary";
import { LINE_NOTICE_TYPE_LABELS, type LineNoticeType } from "@/lib/lineNotices";
import { confirmLineNoticeSent } from "@/lib/lineNoticesFirestore";
import { Button } from "@/components/ui/button";
import styles from "./line-notice-panel.module.css";

/** 行政管理首頁 LINE 待通知區塊的位置；「稍後再發」與存檔訊息都連到這裡。 */
export const LINE_NOTICE_PANEL_HREF = "/admin#line-notices";

export type CreatedLineNotice = { announcementId: string; id: string; type: LineNoticeType; title: string; text: string };

/**
 * 單筆 LINE 待辦：顯示文字、複製、我已發送 LINE；可選「稍後再發」。
 * 複製只把文字放進剪貼簿，不會標記已發送；只有按「我已發送 LINE」才完成待辦。
 */
export function LineNoticeCard({ notice, uid, onSent, onLater }: {
  notice: CreatedLineNotice;
  uid: string;
  onSent?: () => void;
  onLater?: () => void;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const busyRef = useRef(false);
  const copy = async () => {
    const ok = await copyLineAnnouncement(notice.text);
    setStatus(ok ? "已複製。請到 LINE 群組貼上並送出，完成後按「我已發送 LINE」。" : "複製失敗，請手動選取上方文字複製。");
  };
  const confirmSent = async () => {
    // 防止連點重複確認；Rules 也只允許 pending → sent 一次。
    if (busyRef.current || sent) return;
    busyRef.current = true; setBusy(true);
    try {
      await confirmLineNoticeSent(notice, uid);
      setSent(true); setStatus("已記錄為已發送 LINE。");
      onSent?.();
    } catch {
      setStatus("確認失敗，可能已由其他行政人員確認，請重新整理後再試。待通知仍保留在行政管理首頁。");
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <article className={styles.item} aria-label={`LINE 通知：${notice.title}`}>
    <div className={styles.meta}><span className={styles.type}>{LINE_NOTICE_TYPE_LABELS[notice.type]}</span><strong>{notice.title}</strong></div>
    <pre tabIndex={0}>{notice.text}</pre>
    {!sent && <div className={styles.actions}>
      <Button type="button" variant="outline" onClick={() => void copy()}>複製 LINE</Button>
      <Button type="button" className={styles.confirm} onClick={() => void confirmSent()} disabled={busy}>{busy ? "確認中…" : "我已發送 LINE"}</Button>
      {onLater && <Button type="button" variant="outline" onClick={onLater} disabled={busy}>稍後再發</Button>}
    </div>}
    {status && <p className={sent ? styles.status : status.startsWith("確認失敗") || status.startsWith("複製失敗") ? styles.error : styles.status} role="status">{status}</p>}
  </article>;
}

/** 「稍後再發」後顯示：待辦仍保留，可到行政管理首頁的 LINE 待通知處理。 */
export function LineNoticeLaterLink() {
  return <Link href={LINE_NOTICE_PANEL_HREF} className={styles.laterLink}>前往 LINE 待通知</Link>;
}
