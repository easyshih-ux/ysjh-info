"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { usePublisherRequests } from "@/hooks/use-publisher-requests";
import { OTHER_DEPARTMENT_OPTION, departmentGroups, isFixedDepartment, resolveDepartmentSelection, standaloneDepartments, type Department } from "@/lib/departments";
import { approvePublisherRequest, changePublisherDepartment, rejectPublisherRequest, setPublisherEnabled, transferSystemAdmin } from "@/lib/publisherRequestManagement";
import styles from "./publishers.module.css";

export default function PublisherManagementPage() {
  return <AdminAuthGuard><PublisherRequestList /></AdminAuthGuard>;
}

function PublisherRequestList() {
  const router = useRouter();
  const publisher = useAuthorizedPublisher();
  const isSystemAdmin = publisher.role === "systemAdmin";
  const state = usePublisherRequests(isSystemAdmin);
  const [departments, setDepartments] = useState<Record<string, Department | "">>({});
  const [customDepartments, setCustomDepartments] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [publisherQuery, setPublisherQuery] = useState("");
  const [publisherStatus, setPublisherStatus] = useState<"all" | "enabled" | "disabled">("all");
  const [transferTargetUid, setTransferTargetUid] = useState("");
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const filteredPublishers = useMemo(() => {
    const query = publisherQuery.trim().toLocaleLowerCase("zh-Hant");
    return state.publishers.filter(item => {
      const matchesQuery = !query || `${item.displayName ?? ""}\n${item.email}\n${item.defaultDepartment ?? ""}`.toLocaleLowerCase("zh-Hant").includes(query);
      const matchesStatus = publisherStatus === "all" || (publisherStatus === "enabled" ? item.enabled : !item.enabled);
      return matchesQuery && matchesStatus;
    });
  }, [publisherQuery, publisherStatus, state.publishers]);
  const transferCandidates = state.publishers.filter(item => item.uid !== publisher.uid && item.enabled && item.role === "publisher" && item.email.trim() && item.defaultDepartment);
  const transferTarget = transferCandidates.find(item => item.uid === transferTargetUid) ?? null;

  async function handleApprove(targetUid: string) {
    const request = state.requests.find(item => item.uid === targetUid);
    const selection = departments[targetUid] ?? request?.requestedDepartment ?? "";
    const defaultDepartment = resolveDepartmentSelection(selection, customDepartments[targetUid]);
    if (busyAction || !defaultDepartment) {
      setApprovalError(selection === OTHER_DEPARTMENT_OPTION ? "請填寫有效的實際發布單位名稱。" : "請先選擇有效的發布單位。");
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
    const publisher = state.publishers.find(item => item.uid === targetUid);
    const current = publisher?.defaultDepartment ?? "";
    const selection = departments[targetUid] ?? (isFixedDepartment(current) ? current : current ? OTHER_DEPARTMENT_OPTION : "");
    const department = resolveDepartmentSelection(selection, customDepartments[targetUid] ?? (isFixedDepartment(current) ? "" : current));
    if (action === "department" && !department) {
      setApprovalError(selection === OTHER_DEPARTMENT_OPTION ? "請填寫有效的實際發布單位名稱。" : "請選擇有效的發布單位。");
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

  async function handleTransferSystemAdmin() {
    if (busyAction || !transferTarget) return;
    setBusyAction(`transfer:${transferTarget.uid}`);
    setSuccessMessage("");
    setApprovalError("");
    try {
      await transferSystemAdmin(transferTarget.uid);
      setSuccessMessage("最高管理權已完成移交。");
      publisher.refreshAuthorization();
      router.replace("/admin");
    } catch (error) {
      console.error("transferSystemAdmin failed", error);
      setApprovalError("最高管理權移交失敗，雙方權限均未變更，請稍後再試。");
    } finally {
      setBusyAction(null);
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
      <h2>待審申請（{state.requests.length}）</h2>
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
              value={departments[request.uid] ?? request.requestedDepartment ?? ""}
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
              <option value={OTHER_DEPARTMENT_OPTION}>{OTHER_DEPARTMENT_OPTION}</option>
            </select>
          </label>
          {(departments[request.uid] ?? request.requestedDepartment) === OTHER_DEPARTMENT_OPTION && <label>實際發布單位名稱<input value={customDepartments[request.uid] ?? ""} maxLength={30} onChange={event => setCustomDepartments(current => ({ ...current, [request.uid]: event.target.value }))} disabled={busyAction !== null} placeholder="例如：家長會" /></label>}
          <button
            type="button"
            onClick={() => void handleApprove(request.uid)}
            disabled={busyAction !== null || !resolveDepartmentSelection(departments[request.uid] ?? request.requestedDepartment, customDepartments[request.uid])}
          >{busyAction === `approve:${request.uid}` ? "核准處理中…" : "核准發布權限"}</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void runManagementAction(request.uid, "reject")} disabled={busyAction !== null}>拒絕申請</button>
        </div>
      </article>)}
    </div>}

    <div className={styles.heading}><h2>現有發布者（{state.publishers.length}）</h2><span>{state.publishers.length}</span></div>
    <div className={styles.publisherFilters}>
      <label className={styles.search}><span>搜尋發布者</span><div><Search aria-hidden="true" /><input value={publisherQuery} onChange={event => setPublisherQuery(event.target.value)} placeholder="搜尋姓名、Email 或發布單位" /></div></label>
      <label><span>狀態</span><select value={publisherStatus} onChange={event => setPublisherStatus(event.target.value as "all" | "enabled" | "disabled")}><option value="all">全部</option><option value="enabled">啟用中</option><option value="disabled">已停用</option></select></label>
    </div>
    {state.status === "ready" && state.publishers.length === 0 && <p className={styles.notice}>目前沒有發布者資料。</p>}
    {state.status === "ready" && state.publishers.length > 0 && filteredPublishers.length === 0 && <p className={styles.notice}>沒有符合搜尋或篩選條件的發布者。</p>}
    {state.status === "ready" && filteredPublishers.length > 0 && <div className={`${styles.list} ${styles.publisherList}`}>
      {filteredPublishers.map(item => <details key={item.uid}>
        <summary><div className={styles.identity}><h3>{item.displayName?.trim() || "未提供名稱"}</h3><p>{item.defaultDepartment || "尚未設定單位"} · {item.role === "systemAdmin" ? "系統管理員" : item.enabled ? "啟用中" : "已停用"}</p><small>{item.email || "帳號 email 尚未同步"}</small></div><ChevronDown aria-hidden="true" /></summary>
        <div className={styles.publisherActions}><small>UID：{item.uid}</small><div className={styles.approval}>
          <span>{item.role === "systemAdmin" ? "系統管理員" : item.enabled ? "已啟用" : "已停用"}</span>
          <label>發布單位<select value={departments[item.uid] ?? (isFixedDepartment(item.defaultDepartment) ? item.defaultDepartment : item.defaultDepartment ? OTHER_DEPARTMENT_OPTION : "")} onChange={event => setDepartments(current => ({ ...current, [item.uid]: event.target.value as Department }))} disabled={busyAction !== null || item.role === "systemAdmin"}>
            <option value="" disabled>請選擇發布單位</option>
            {standaloneDepartments.map(department => <option key={department} value={department}>{department}</option>)}
            {departmentGroups.flatMap(group => [<option key={group.office} value={group.office}>【{group.office}】</option>, ...group.departments.slice(1).map(department => <option key={department} value={department}>　{department}</option>)])}
            <option value={OTHER_DEPARTMENT_OPTION}>{OTHER_DEPARTMENT_OPTION}</option>
          </select></label>
          {(departments[item.uid] ?? (isFixedDepartment(item.defaultDepartment) ? item.defaultDepartment : OTHER_DEPARTMENT_OPTION)) === OTHER_DEPARTMENT_OPTION && item.role === "publisher" && <label>實際發布單位名稱<input value={customDepartments[item.uid] ?? (isFixedDepartment(item.defaultDepartment) ? "" : item.defaultDepartment ?? "")} maxLength={30} onChange={event => setCustomDepartments(current => ({ ...current, [item.uid]: event.target.value }))} disabled={busyAction !== null} /></label>}
          {item.role === "publisher" && <><button type="button" onClick={() => void runManagementAction(item.uid, "department")} disabled={busyAction !== null || !resolveDepartmentSelection(departments[item.uid] ?? (isFixedDepartment(item.defaultDepartment) ? item.defaultDepartment : OTHER_DEPARTMENT_OPTION), customDepartments[item.uid] ?? (isFixedDepartment(item.defaultDepartment) ? "" : item.defaultDepartment))}>儲存單位</button><button type="button" className={styles.secondaryButton} onClick={() => void runManagementAction(item.uid, item.enabled ? "disable" : "enable")} disabled={busyAction !== null}>{item.enabled ? "停用發布權限" : "重新啟用"}</button></>}
        </div></div>
      </details>)}
    </div>}

    <section className={styles.transferPanel} aria-labelledby="system-admin-transfer-title">
      <p className={styles.kicker}>SYSTEM ADMIN TRANSFER</p>
      <h2 id="system-admin-transfer-title">最高管理權移交</h2>
      <div className={styles.currentAdmin}>
        <strong>目前最高管理者</strong>
        <span>{publisher.displayName?.trim() || "未提供名稱"}</span>
        <small>{publisher.email} · {publisher.defaultDepartment}</small>
      </div>
      <label>
        選擇接任者
        <select value={transferTargetUid} onChange={event => { setTransferTargetUid(event.target.value); setConfirmingTransfer(false); }} disabled={busyAction !== null}>
          <option value="">請選擇已啟用的發布者</option>
          {transferCandidates.map(item => <option key={item.uid} value={item.uid}>{item.displayName?.trim() || "未提供名稱"}｜{item.email}｜{item.defaultDepartment || "尚未設定單位"}</option>)}
        </select>
      </label>
      {transferCandidates.length === 0 && <p className={styles.notice}>目前沒有符合資格的接任者。</p>}
      {transferTarget && <div className={styles.transferTarget}>
        <strong>{transferTarget.displayName?.trim() || "未提供名稱"}</strong>
        <span>{transferTarget.email}</span>
        <span>{transferTarget.defaultDepartment || "尚未設定單位"}</span>
      </div>}
      {!confirmingTransfer
        ? <button type="button" onClick={() => setConfirmingTransfer(true)} disabled={busyAction !== null || !transferTarget}>移交最高管理權</button>
        : <div className={styles.transferConfirmation} role="alert">
          <strong>請再次確認</strong>
          <p>移交後，對方將取得最高管理權限；你目前的最高管理權限將被移除，但仍保留一般發布者資格。</p>
          <div>
            <button type="button" className={styles.dangerButton} onClick={() => void handleTransferSystemAdmin()} disabled={busyAction !== null}>{busyAction?.startsWith("transfer:") ? "移交處理中…" : "確認移交最高管理權"}</button>
            <button type="button" className={styles.secondaryButton} onClick={() => setConfirmingTransfer(false)} disabled={busyAction !== null}>取消</button>
          </div>
        </div>}
    </section>
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
