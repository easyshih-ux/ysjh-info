"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { fetchRetentionCleanupStatus } from "@/lib/retentionMonitor";
import { RetentionMonitorView, type RetentionMonitorState } from "./retention-monitor-view";
import styles from "./retention-monitor.module.css";

export default function RetentionMonitorPage() {
  return <AdminAuthGuard><RetentionMonitorGate /></AdminAuthGuard>;
}

/** 前端權限檢查：非 systemAdmin 不呼叫後端；後端 callable 另行驗證 systemAdmin。 */
function RetentionMonitorGate() {
  const publisher = useAuthorizedPublisher();
  if (publisher.role !== "systemAdmin") {
    return <main className={styles.page}><div className={styles.shell}><Link className={styles.backLink} href="/admin"><ArrowLeft />返回行政管理</Link><p className={styles.error} role="alert">權限不足：此功能僅供系統管理員使用。</p></div></main>;
  }
  return <RetentionMonitorLoader />;
}

function errorMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code).replace(/^functions\//, "") : "";
  if (code === "permission-denied") return "權限不足：此功能僅供系統管理員使用。";
  if (code === "unauthenticated") return "登入狀態已失效，請重新登入後再試。";
  return "目前無法取得自動清理狀態，請稍後再試。";
}

function RetentionMonitorLoader() {
  const [state, setState] = useState<RetentionMonitorState>({ status: "loading" });
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    fetchRetentionCleanupStatus()
      .then(data => { if (active) setState({ status: "ready", data, refreshing: false }); })
      .catch(error => { if (active) setState({ status: "error", message: errorMessage(error) }); });
    return () => { active = false; };
  }, []);

  // 立即檢查：只呼叫唯讀 callable（refresh: true），不觸發排程、不刪除或修改任何資料。
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState(current => current.status === "ready" ? { ...current, refreshing: true, refreshError: undefined } : { status: "loading" });
    try {
      const data = await fetchRetentionCleanupStatus(true);
      setState({ status: "ready", data, refreshing: false });
    } catch (error) {
      setState(current => current.status === "ready" ? { ...current, refreshing: false, refreshError: errorMessage(error) } : { status: "error", message: errorMessage(error) });
    } finally {
      busy.current = false;
    }
  }, []);

  return <RetentionMonitorView state={state} onRefresh={refresh} />;
}
