"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import type { RetentionPolicy } from "@/lib/announcementRetention";
import { getFirestoreClient } from "@/lib/firestoreClient";
import type { RetentionReviewData } from "@/lib/retentionReview";
import { applyRetentionPolicyBatch, readRetentionReviewData } from "@/lib/retentionReviewFirestore";
import { formatReviewDate } from "@/lib/retentionReview";
import { taipeiDateKey } from "@/lib/taipeiDate";
import { RetentionReviewView } from "./retention-review-view";
import styles from "./retention-review.module.css";

export default function RetentionReviewPage() {
  return <AdminAuthGuard><RetentionReviewGate /></AdminAuthGuard>;
}

/** 前端權限檢查：非 systemAdmin 不讀取資料、不顯示操作。實際寫入仍由 Firestore Rules 與交易內身分檢查把關。 */
function RetentionReviewGate() {
  const publisher = useAuthorizedPublisher();
  if (publisher.role !== "systemAdmin") {
    return <main className={styles.page}><div className={styles.shell}><Link className={styles.backLink} href="/admin"><ArrowLeft />返回行政管理</Link><p className={styles.error} role="alert">此功能僅供系統管理員使用。</p></div></main>;
  }
  return <RetentionReviewLoader uid={publisher.uid} />;
}

const formatPublishedAt = (publishedAt: string) => formatReviewDate(taipeiDateKey(new Date(publishedAt)));

function RetentionReviewLoader({ uid }: { uid: string }) {
  const [data, setData] = useState<RetentionReviewData | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await readRetentionReviewData(getFirestoreClient()));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    readRetentionReviewData(getFirestoreClient())
      .then(value => { if (active) setData(value); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);

  const apply = useCallback((ids: string[], policy: RetentionPolicy) => applyRetentionPolicyBatch(getFirestoreClient(), uid, ids, policy), [uid]);

  if (loadError && !data) return <main className={styles.page}><div className={styles.shell}><Link className={styles.backLink} href="/admin"><ArrowLeft />返回行政管理</Link><p className={styles.error} role="alert">目前無法讀取公告，請稍後再試。</p></div></main>;
  if (!data) return <main className={styles.page}><div className={styles.shell}><p className={styles.empty} aria-live="polite">公告載入中…</p></div></main>;
  return <RetentionReviewView data={data} formatPublishedAt={formatPublishedAt} onApply={apply} onReload={reload} />;
}
