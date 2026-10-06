"use client";

import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { LineSummaryCard } from "@/components/line-summary-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { deleteRelatedFollowUp, mergeAnnouncementFollowUps, readAnnouncementFollowUps, updateRelatedFollowUp } from "@/lib/announcementFollowUps";
import { formatFileSize } from "@/lib/attachmentFiles";
import { formatContactCompact } from "@/lib/departmentContacts";
import { formatFollowUpType, formatImportantEventSchedule, type Announcement, type FollowUp } from "@/lib/announcements";
import type { AuthorizedPublisherContextValue } from "@/lib/publisherAccess";
import styles from "./manage.module.css";

const formatDateTime = (value: string) => new Date(value).toLocaleString("zh-TW");

export function AnnouncementDetails({
  item,
  publisher,
  onClose,
}: {
  item: Announcement | null;
  publisher: AuthorizedPublisherContextValue;
  onClose: () => void;
}) {
  const [currentFollowUps, setCurrentFollowUps] = useState<FollowUp[]>([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [editingRelated, setEditingRelated] = useState<FollowUp | null>(null);
  const [relatedMessage, setRelatedMessage] = useState("");
  const [relatedBusy, setRelatedBusy] = useState(false);

  useEffect(() => {
    if (!item) {
      setCurrentFollowUps([]);
      return;
    }
    let active = true;
    setCurrentFollowUps([]);
    setFollowUpsLoading(true);
    readAnnouncementFollowUps(item.id)
      .then(value => {
        if (active) setCurrentFollowUps(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setFollowUpsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [item?.id]);

  const followUps = item ? mergeAnnouncementFollowUps(item.followUps, currentFollowUps) : [];
  const original = followUps.filter(value => value.type !== "related");
  const related = followUps.filter(value => value.type === "related");
  const canManageRelated = (value: FollowUp) => publisher.role === "systemAdmin" || value.authorUid === publisher.uid;

  const saveRelated = async () => {
    if (!item || !editingRelated?.id || !relatedMessage.trim() || relatedBusy) return;
    setRelatedBusy(true);
    try {
      const updated = await updateRelatedFollowUp(item.id, editingRelated.id, relatedMessage);
      setCurrentFollowUps(values => values.map(value => value.id === updated.id ? updated : value));
      setEditingRelated(null);
    } finally {
      setRelatedBusy(false);
    }
  };

  const removeRelated = async (value: FollowUp) => {
    if (!item || !value.id || relatedBusy || !window.confirm("確定刪除這筆相關補充？")) return;
    setRelatedBusy(true);
    try {
      await deleteRelatedFollowUp(item.id, value.id);
      setCurrentFollowUps(values => values.filter(entry => entry.id !== value.id));
    } finally {
      setRelatedBusy(false);
    }
  };

  return (
    <>
      <Dialog open={!!item} onOpenChange={open => !open && onClose()}>
        <DialogContent className={styles.details}>
          {item && (
            <>
              <DialogHeader>
                <DialogDescription>{item.department} · {item.academicYear} 學年度</DialogDescription>
                <DialogTitle>{item.title}</DialogTitle>
              </DialogHeader>
              <dl className={styles.timestamps}>
                <div>
                  <dt>發布時間</dt>
                  <dd>{formatDateTime(item.publishedAt)}</dd>
                </div>
                {item.contentUpdatedAt && (
                  <div>
                    <dt>更新時間</dt>
                    <dd>{formatDateTime(item.contentUpdatedAt)}</dd>
                  </div>
                )}
                <div>
                  <dt>適用對象</dt>
                  <dd>{item.audiences.join("、") || "未設定"}</dd>
                </div>
              </dl>
              <section>
                <h3>公告內容</h3>
                <p className={styles.fullContent}>{item.content}</p>
              </section>
              <DetailList title="重要日期／活動" empty="無重要事項" values={item.importantEvents.map(entry => `${formatImportantEventSchedule(entry)}｜${entry.title}`)} />
              <DetailList title="繳交／填報期限" empty="無截止期限" values={item.deadlines.map(entry => `${entry.date}${entry.time ? ` ${entry.time}` : ""}｜${entry.label}`)} />
              <ReadOnlyImages item={item} />
              <section>
                <h3>相關網址</h3>
                {item.links.length ? (
                  <ul>
                    {item.links.map(link => (
                      <li key={link.id}>
                        <a href={link.url} target="_blank" rel="noopener noreferrer">
                          {link.label}{link.isPrimary ? "（主要連結）" : ""}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : <p>無相關網址</p>}
              </section>
              <section>
                <h3>補充／提醒</h3>
                {followUpsLoading ? <p>補充／提醒載入中…</p> : original.length ? (
                  <div className={styles.followUps}>
                    {original.map((followUp, index) => (
                      <article key={followUp.id ?? `${followUp.createdAt}-${index}`}>
                        <strong>{formatFollowUpType(followUp.type)}</strong>
                        <time>{followUp.department ?? item.department}｜{formatDateTime(followUp.createdAt)}</time>
                        <p>{followUp.message}</p>
                      </article>
                    ))}
                  </div>
                ) : <p>無補充或提醒</p>}
              </section>
              <section>
                <h3>💬 相關補充</h3>
                {related.length ? (
                  <div className={`${styles.followUps} ${styles.relatedFollowUps}`}>
                    {related.map(value => (
                      <article key={value.id}>
                        <strong>{value.department}｜{formatDateTime(value.createdAt)}</strong>
                        {value.updatedAt && <small>🔄 已編輯</small>}
                        <p>{value.message}</p>
                        {canManageRelated(value) && (
                          <div className={styles.relatedActions}>
                            <Button variant="ghost" size="sm" onClick={() => {
                              setEditingRelated(value);
                              setRelatedMessage(value.message);
                            }}>
                              修改
                            </Button>
                            <Button variant="ghost" size="sm" disabled={relatedBusy} onClick={() => void removeRelated(value)}>
                              刪除
                            </Button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : <p>無相關補充</p>}
              </section>
              <LineSummaryCard announcement={item} />
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingRelated} onOpenChange={open => !open && !relatedBusy && setEditingRelated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改相關補充</DialogTitle>
            <DialogDescription>僅會修改這筆補充內容。</DialogDescription>
          </DialogHeader>
          <label className={styles.dialogField}>
            內容
            <Textarea value={relatedMessage} onChange={event => setRelatedMessage(event.target.value)} />
          </label>
          <Button className={styles.primaryCta} disabled={!relatedMessage.trim() || relatedBusy} onClick={() => void saveRelated()}>
            {relatedBusy ? "儲存中…" : "儲存修改"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailList({ title, empty, values }: { title: string; empty: string; values: string[] }) {
  return <section><h3>{title}</h3>{values.length ? <ul>{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul> : <p>{empty}</p>}</section>;
}

export function ReadOnlyImages({ item }: { item: Announcement }) {
  const images = item.attachments.filter(attachment => attachment.type === "image");
  const pdfs = item.attachments.filter(attachment => attachment.type === "pdf");
  return <>{item.contact && <section className={styles.contactDisplay}><h3>業務聯絡資訊</h3><p>{formatContactCompact(item.contact)}</p></section>}<section className={styles.readOnlyImages}><h3>公告附件（唯讀）</h3>{images.length ? <div>{images.map(attachment => <figure key={attachment.id}><img src={attachment.url} alt={attachment.caption || attachment.name} /><figcaption><strong>{attachment.name}</strong>{attachment.caption && <span>{attachment.caption}</span>}</figcaption></figure>)}</div> : <p>無公告圖片</p>}{pdfs.length ? <div className={styles.pdfAttachments}>{pdfs.map(attachment => <a key={attachment.id} href={attachment.url} target="_blank" rel="noopener noreferrer"><FileText /><span><strong>{attachment.name}</strong><small>PDF・{formatFileSize(attachment.sizeBytes)}</small></span>開啟文件 ↗</a>)}</div> : <p>無 PDF 文件</p>}</section></>;
}
