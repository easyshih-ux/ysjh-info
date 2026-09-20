"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { usePublisherRequests } from "@/hooks/use-publisher-requests";
import { departmentGroups, isDepartment, standaloneDepartments, type Department } from "@/lib/departments";
import { approvePublisherRequest, changePublisherDepartment, rejectPublisherRequest, setPublisherEnabled } from "@/lib/publisherRequestManagement";
import styles from "./publishers.module.css";

export default function PublisherManagementPage() {
  return <AdminAuthGuard><PublisherRequestList /></AdminAuthGuard>;
}

function PublisherRequestList() {
  const publisher = useAuthorizedPublisher();
  const isSystemAdmin = publisher.role === "systemAdmin";
  const state = usePublisherRequests(isSystemAdmin);
  const [departments, setDepartments] = useState<Record<string, Department | "">>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [approvalError, setApprovalError] = useState("");

  async function handleApprove(targetUid: string) {
    const defaultDepartment = departments[targetUid];
    if (busyAction || !isDepartment(defaultDepartment)) {
      setApprovalError("請先選擇有效的正式發布單位。");
      return;
    }
    setBusyAction(`approve:${targetUid}`);
    setSuccessMessage("");
    setApprovalError("");
    try {
      await approvePublisherRequest(targetUid, defaultDepartment);
      setSuccessMessage("發布權限已核准。");
      await state.refresh();
    } catch (error) {
      console.error("approvePublisherRequest failed", error);
      setApprovalError("目前無法核准發布權限，請稍後再試。");
    } finally {
      setBusyAction(null);
    }
  }

  async function runManagementAction(targetUid: string, action: "reject" | "enable" | "disable" | "department") {
    if (busyAction) return;
    const department = departments[targetUid];
    if (action === "department" && !isDepartment(department)) {
      setApprovalError("請選擇有效的正式發布單位。");
      return;
    }
    setBusyAction(`${action}:${targetUid}`);
    setSuccessMessage(""); setApprovalError("");
    try {
      if (action === "reject") await rejectPublisherRequest(targetUid);
      else if (action === "department") await changePublisherDepartment(targetUid, department as Department);
      else await setPublisherEnabled(targetUid, action === "enable");
      setSuccessMessage(action === "reject" ? "申請已拒絕。" : action === "department" ? "發布單位已更新。" : action === "enable" ? "發布者已重新啟用。" : "發布者已停用。");
      await state.refresh();
    } catch (error) {
      console.error("publisher management action failed", error);
      setApprovalError("操作失敗，資料未變更，請稍後再試。");
    } finally { setBusyAction(null); }
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
          <time dateTime={new Date(request.requestedAtMillis).toISOString()}>
            申請時間：{formatRequestedAt(new Date(request.requestedAtMillis))}
          </time>
        </div>
        <div className={styles.approval}>
          <span>待核准</span>
          <label>
            發布單位
            <select
              value={departments[request.uid] ?? ""}
              onChange={event => setDepartments(current => ({
                ...current,
                [request.uid]: event.target.value as Department,
              }))}
              disabled={busyAction !== null}
            >
              <option value="" disabled>請選擇發布單位</option>
              {standaloneDepartments.map(department => <option key={department} value={department}>{department}</option>)}
              {departmentGroups.flatMap(group => [
                <option key={group.office} value={group.office}>【{group.office}】</option>,
                ...group.departments.slice(1).map(department => (
                  <option key={department} value={department}>　{department}</option>
                )),
              ])}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleApprove(request.uid)}
            disabled={busyAction !== null || !departments[request.uid]}
          >{busyAction === `approve:${request.uid}` ? "核准處理中…" : "核准發布權限"}</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void runManagementAction(request.uid, "reject")} disabled={busyAction !== null}>拒絕申請</button>
        </div>
      </article>)}
    </div>}

    <div className={styles.heading}><h2>現有發布者</h2><span>{state.publishers.length}</span></div>
    {state.status === "ready" && state.publishers.length === 0 && <p className={styles.notice}>目前沒有發布者資料。</p>}
    {state.status === "ready" && state.publishers.length > 0 && <div className={styles.list}>
      {state.publishers.map(item => <article key={item.uid}>
        <div className={styles.identity}><h3>{item.displayName?.trim() || "未提供名稱"}</h3><p>{item.email || "帳號 email 尚未同步"}</p><small>UID：{item.uid}</small></div>
        <div className={styles.approval}>
          <span>{item.role === "systemAdmin" ? "系統管理員" : item.enabled ? "已啟用" : "已停用"}</span>
          <label>發布單位<select value={departments[item.uid] ?? item.defaultDepartment ?? ""} onChange={event => setDepartments(current => ({ ...current, [item.uid]: event.target.value as Department }))} disabled={busyAction !== null || item.role === "systemAdmin"}>
            <option value="" disabled>請選擇發布單位</option>
            {standaloneDepartments.map(department => <option key={department} value={department}>{department}</option>)}
            {departmentGroups.flatMap(group => [<option key={group.office} value={group.office}>【{group.office}】</option>, ...group.departments.slice(1).map(department => <option key={department} value={department}>　{department}</option>)])}
          </select></label>
          {item.role === "publisher" && <><button type="button" onClick={() => void runManagementAction(item.uid, "department")} disabled={busyAction !== null || !isDepartment(departments[item.uid] ?? item.defaultDepartment)}>儲存單位</button><button type="button" className={styles.secondaryButton} onClick={() => void runManagementAction(item.uid, item.enabled ? "disable" : "enable")} disabled={busyAction !== null}>{item.enabled ? "停用發布權限" : "重新啟用"}</button></>}
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
