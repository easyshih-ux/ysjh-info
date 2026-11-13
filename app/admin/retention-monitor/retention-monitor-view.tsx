"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  classifyRetentionRow, countRowStates, daysBetween, filterRetentionRows, formatDateKey, formatTaipeiDateTime, paginateRows,
  RETENTION_MODE_INFO, RETENTION_PREVIEW_PAGE_SIZE, RETENTION_ROW_STATE_LABELS, RETENTION_RUN_OUTCOME_LABELS, retentionReasonLabels,
  type RetentionCleanupStatus, type RetentionPreviewFilter, type RetentionRowState, type RetentionRunSummary, type RetentionStatusAnnouncement,
} from "@/lib/retentionMonitor";
import styles from "./retention-monitor.module.css";

export type RetentionMonitorState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: RetentionCleanupStatus; refreshing: boolean; refreshError?: string };

export function RetentionMonitorView({ state, onRefresh }: { state: RetentionMonitorState; onRefresh: () => void }) {
  return <main className={styles.page}>
    <header><div>
      <Link href="/admin"><ArrowLeft />返回行政管理</Link>
      <p>系統管理員專用</p>
      <h1>自動清理監控</h1>
      <span>查看自動清理狀態、即將到期的公告與執行紀錄。本頁只讀取資料，不會刪除或修改公告。</span>
    </div></header>
    <div className={styles.shell}>
      {state.status === "loading" && <p className={styles.notice} role="status" aria-live="polite">正在讀取自動清理狀態…</p>}
      {state.status === "error" && <div className={styles.error} role="alert"><p>{state.message}</p><Button variant="outline" size="sm" onClick={onRefresh}>重新讀取</Button></div>}
      {state.status === "ready" && <ReadyView data={state.data} refreshing={state.refreshing} refreshError={state.refreshError} onRefresh={onRefresh} />}
    </div>
  </main>;
}

function ReadyView({ data, refreshing, refreshError, onRefresh }: { data: RetentionCleanupStatus; refreshing: boolean; refreshError?: string; onRefresh: () => void }) {
  const mode = RETENTION_MODE_INFO[data.settings.mode];
  const latestRun = data.runs[0];
  return <>
    <section className={styles.section} aria-labelledby="status-title">
      <h2 id="status-title">自動清理狀態</h2>
      <div className={styles.statusGrid}>
        <div className={`${styles.card} ${styles[`mode_${data.settings.mode}`]}`}>
          <span>目前模式</span>
          <strong>{mode.label}</strong>
          <small>{mode.description}</small>
        </div>
        <div className={styles.card}><span>每天執行時間</span><strong>{data.schedule.label}</strong><small>每次最多處理 {data.settings.maxDeletesPerRun} 篇</small></div>
        <div className={styles.card}><span>今天符合清理資格</span><strong>{data.summary.eligible} 篇</strong><small>共檢查 {data.summary.scanned} 篇公告{data.summary.deferredCount > 0 ? `，${data.summary.deferredCount} 篇延後處理` : ""}</small></div>
        <div className={styles.card}>
          <span>最近一次執行</span>
          {latestRun ? <>
            <strong>{runTime(latestRun)}</strong>
            <small>{runResultText(latestRun)}{(latestRun.errorCount ?? 0) > 0 ? `；錯誤 ${latestRun.errorCount} 筆` : "；無錯誤"}</small>
          </> : <><strong>執行紀錄尚未啟用</strong><small>每日排程目前只寫入系統日誌；網站執行紀錄將於後續階段啟用。</small></>}
        </div>
      </div>
      {data.errors.length > 0 && <p className={styles.warning} role="status">本次查詢有 {data.errors.length} 項資料讀取異常（受影響的公告已列為安全阻擋，不會被清理）：{data.errors.slice(0, 3).join("；")}</p>}
    </section>

    <section className={styles.section} aria-labelledby="check-title">
      <h2 id="check-title">立即檢查</h2>
      <div className={styles.checkBar}>
        <Button className={styles.primary} onClick={onRefresh} disabled={refreshing}><RefreshCw aria-hidden="true" />{refreshing ? "檢查中…" : "立即檢查"}</Button>
        <strong className={styles.readOnlyNote}>僅重新檢查，不會刪除或修改公告。</strong>
      </div>
      <p className={styles.hint}>
        最後檢查：{formatTaipeiDateTime(data.generatedAt)}（臺灣時間）・{data.cached ? "顯示 5 分鐘內的快取結果" : "剛重新計算"}・
        {data.refreshThrottled ? `60 秒內只能重新檢查一次，可於 ${formatTaipeiDateTime(data.nextRefreshAt)} 後再試` : "每 60 秒最多重新檢查一次"}
      </p>
      {refreshError && <p className={styles.error} role="alert">{refreshError}</p>}
    </section>

    <PreviewSection data={data} />
    <RunsSection runs={data.runs} />
  </>;
}

/** 執行時間一律以臺灣時間 YYYY/MM/DD HH:mm 顯示；startedAt 缺漏時退回後端的臺灣時間字串。 */
function runTime(run: RetentionRunSummary) {
  const formatted = formatTaipeiDateTime(run.startedAt);
  return formatted !== "—" ? formatted : run.startedAtTaipei ? run.startedAtTaipei.replace(" (Asia/Taipei)", "").slice(0, 16).replaceAll("-", "/") : "—";
}

function runResultText(run: RetentionRunSummary) {
  const mode = run.mode === "live" ? "正式清理" : run.mode === "dryRun" ? "模擬檢查" : run.mode === "off" ? "已停止" : (run.mode ?? "未知模式");
  const parts = [`${mode}：掃描 ${run.scanned ?? "—"} 篇`];
  if (run.deleted !== null) parts.push(`刪除 ${run.deleted} 篇`);
  parts.push(`跳過 ${run.skipped ?? "—"} 篇`);
  if (run.failed !== null) parts.push(`失敗 ${run.failed} 篇`);
  return parts.join("、");
}

function PreviewSection({ data }: { data: RetentionCleanupStatus }) {
  const [filter, setFilter] = useState<RetentionPreviewFilter>("within60");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterRetentionRows(data.announcements, filter, data.today), [data.announcements, filter, data.today]);
  const counts = useMemo(() => countRowStates(data.announcements), [data.announcements]);
  const { page: current, pageCount, pageRows } = paginateRows(filtered, page);
  const changeFilter = (next: RetentionPreviewFilter) => { setFilter(next); setPage(1); };
  return <section className={styles.section} aria-labelledby="preview-title">
    <h2 id="preview-title">公告清理預覽</h2>
    <ul className={styles.stateCounts} aria-label="各狀態篇數">
      {(["eligible", "dueButProtected", "notYetDue", "blocked", "longTerm"] as RetentionRowState[]).map(state => <li key={state}><span className={styles[`state_${state}`]}>{RETENTION_ROW_STATE_LABELS[state]}</span><strong>{counts[state]}</strong></li>)}
    </ul>
    <div className={styles.filterBar} role="group" aria-label="篩選">
      <Button variant="outline" size="sm" className={filter === "within60" ? styles.filterActive : undefined} onClick={() => changeFilter("within60")} aria-pressed={filter === "within60"}>60 天內到期</Button>
      <Button variant="outline" size="sm" className={filter === "all" ? styles.filterActive : undefined} onClick={() => changeFilter("all")} aria-pressed={filter === "all"}>全部公告</Button>
      <small className={styles.hint}>依預計清理日期排序（今天：{formatDateKey(data.today)}）。「已到期但受保護」的公告不會被刪除。</small>
    </div>
    {filtered.length === 0 ? <p className={styles.empty}>{filter === "within60" ? "60 天內沒有即將到期的公告。" : "目前沒有公告。"}</p>
      : <ul className={styles.rows} aria-label="公告清理預覽">{pageRows.map(row => <PreviewRow key={row.id} row={row} today={data.today} />)}</ul>}
    {filtered.length > RETENTION_PREVIEW_PAGE_SIZE && <nav className={styles.pager} aria-label="分頁">
      <Button variant="outline" size="sm" onClick={() => setPage(current - 1)} disabled={current <= 1}>上一頁</Button>
      <span>第 {current} / {pageCount} 頁・共 {filtered.length} 篇</span>
      <Button variant="outline" size="sm" onClick={() => setPage(current + 1)} disabled={current >= pageCount}>下一頁</Button>
    </nav>}
  </section>;
}

function PreviewRow({ row, today }: { row: RetentionStatusAnnouncement; today: string }) {
  const state = classifyRetentionRow(row);
  const reasons = retentionReasonLabels(row);
  const days = row.finalCleanupDate ? daysBetween(today, row.finalCleanupDate) : null;
  const when = days === null ? "無法計算" : days > 0 ? `還有 ${days} 天` : days === 0 ? "今天到期" : `已到期 ${-days} 天`;
  return <li className={styles.row}>
    <div className={styles.rowMain}>
      <strong>{row.title}</strong>
      <span className={styles.rowMeta}>{row.department || "—"}{row.publicationStatus === "withdrawn" ? "・已下架" : ""}</span>
    </div>
    <div className={styles.rowDate}><span>預計清理日期</span><strong>{formatDateKey(row.finalCleanupDate)}</strong><small>{state === "longTerm" ? "長期保留，不會清理" : when}</small></div>
    <div className={styles.rowState}>
      <span className={styles[`state_${state}`]}>{RETENTION_ROW_STATE_LABELS[state]}</span>
      {reasons.length > 0 && <small>{state === "blocked" ? "阻擋原因" : "保護原因"}：{reasons.join("、")}</small>}
    </div>
  </li>;
}

function RunsSection({ runs }: { runs: RetentionRunSummary[] }) {
  return <section className={styles.section} aria-labelledby="runs-title">
    <h2 id="runs-title">最近執行紀錄</h2>
    {runs.length === 0 ? <div className={styles.empty}>
      <strong>執行紀錄尚未啟用</strong>
      <p>每日排程目前只把結果寫入系統日誌（Cloud Logging）。網站上的執行紀錄將在後續階段啟用，屆時會顯示最近 30 次的執行時間、模式、掃描數、刪除數、跳過數與失敗數。</p>
    </div> : <ul className={styles.runs} aria-label="最近執行紀錄">{runs.map(run => <li key={run.id}>
      <details>
        <summary>
          <span>{runTime(run)}</span>
          <span>{run.mode === "live" ? "正式清理" : run.mode === "dryRun" ? "模擬檢查" : run.mode ?? "—"}</span>
          <span>掃描 {run.scanned ?? "—"}</span>
          <span>刪除 {run.deleted ?? "—"}</span>
          <span>跳過 {run.skipped ?? "—"}</span>
          <span className={(run.failed ?? 0) > 0 ? styles.failed : undefined}>失敗 {run.failed ?? "—"}</span>
        </summary>
        {run.results.length === 0 ? <p className={styles.hint}>本次沒有處理任何公告。</p>
          : <ul className={styles.runResults}>{run.results.map(result => <li key={result.id}><code>{result.id}</code>{RETENTION_RUN_OUTCOME_LABELS[result.outcome] ?? result.outcome}{result.detail ? `（${result.detail}）` : ""}</li>)}</ul>}
      </details>
    </li>)}</ul>}
  </section>;
}
