"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { usePublisherRequests } from "@/hooks/use-publisher-requests";
import { DEPARTMENTS, type Department } from "@/lib/departments";
import { approvePublisherRequest } from "@/lib/publisherRequestManagement";
import styles from "./publishers.module.css";

export default function PublisherManagementPage() {
  return <AdminAuthGuard><PublisherRequestList /></AdminAuthGuard>;
}

function PublisherRequestList() {
  const publisher = useAuthorizedPublisher();
  const isSystemAdmin = publisher.role === "systemAdmin";
  const state = usePublisherRequests(isSystemAdmin);
  const [departments, setDepartments] = useState<Record<string, Department>>({});
  const [approvingUid, setApprovingUid] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [approvalError, setApprovalError] = useState("");

  async function handleApprove(targetUid: string) {
    if (approvingUid) return;
    setApprovingUid(targetUid);
    setSuccessMessage("");
    setApprovalError("");
    try {
      await approvePublisherRequest(targetUid, departments[targetUid] ?? DEPARTMENTS[0]);
      setSuccessMessage("發布權限已核准。");
      await state.refresh();
    } catch (error) {
      console.error("approvePublisherRequest failed", error);
      setApprovalError("目前無法核准發布權限，請稍後再試。");
    } finally {
      setApprovingUid(null);
    }
  }

  if (!isSystemAdmin) {
    return <main className={styles.page}><section className={styles.panel}>
      <Link className={styles.back} href="/admin"><ArrowLeft />返回行政管理</Link>
      <h1>發布者管理</h1>
      <p className={styles.error} role="alert">此功能僅供系統管理員使用。</p>
    </section></main>;
  }

  return <main className={styles.page}><section className={styles.panel}>
    <Link className={styles.back} href="/admin"><ArrowLeft />返回行政管理</Link>
    <p className={styles.kicker}>PUBLISHER MANAGEMENT</p>
    <h1>發布者管理</h1>
    <div className={styles.heading}>
      <h2>待核准發布者</h2>
      <span aria-label={`待核准 ${state.requests.length} 筆`}>{state.requests.length}</span>
    </div>

    {successMessage && <p className={styles.success} role="status">{successMessage}</p>}
    {approvalError && <p className={styles.error} role="alert">{approvalError}</p>}
    {state.status === "loading" && <p className={styles.notice} role="status">正在讀取發布權限申請…</p>}
    {state.status === "error" && <p className={styles.error} role="alert">目前無法讀取發布權限申請，請稍後再試。</p>}
    {state.status === "ready" && state.requests.length === 0 && <p className={styles.notice}>目前沒有待核准的發布權限申請。</p>}
    {state.status === "ready" && state.requests.length > 0 && <div className={styles.list}>
      {state.requests.map(request => <article key={request.uid}>
        <div className={styles.identity}>
          <h3>{request.displayName?.trim() || "未提供名稱"}</h3>
          <p>{request.email}</p>
          <time dateTime={request.requestedAt.toDate().toISOString()}>
            申請時間：{formatRequestedAt(request.requestedAt.toDate())}
          </time>
        </div>
        <div className={styles.approval}>
          <span>待核准</span>
          <label>
            發布單位
            <select
              value={departments[request.uid] ?? DEPARTMENTS[0]}
              onChange={event => setDepartments(current => ({
                ...current,
                [request.uid]: event.target.value as Department,
              }))}
              disabled={approvingUid === request.uid}
            >
              {DEPARTMENTS.map(department => <option key={department} value={department}>{department}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleApprove(request.uid)}
            disabled={approvingUid !== null}
          >{approvingUid === request.uid ? "核准處理中…" : "核准發布權限"}</button>
        </div>
      </article>)}
    </div>}
  </section></main>;
}

function formatRequestedAt(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
