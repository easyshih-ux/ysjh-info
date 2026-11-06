"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RETENTION_POLICY_LABELS, type RetentionPolicy } from "@/lib/announcementRetention";
import {
  academicYearOptions, autoCleanupBlockReason, canSubmitRetentionBatch, DEFAULT_RETENTION_REVIEW_FILTERS, departmentOptions, filterRetentionReviewItems,
  formatReviewDate, paginate, RETENTION_FAIL_REASON_LABELS, RETENTION_REVIEW_PAGE_SIZE, RETENTION_SKIP_REASON_LABELS, summarizeRetentionOutcomes,
  summarizeSelection, type DeadlineFilter, type RetentionBatchOutcome, type RetentionBatchSummary, type RetentionReviewData, type RetentionReviewFilters, type RetentionReviewItem,
} from "@/lib/retentionReview";
import styles from "./retention-review.module.css";

export interface RetentionReviewViewProps {
  data: RetentionReviewData;
  /** 發布日期顯示（YYYY-MM-DD → 呈現格式），由頁面以台北時區提供。 */
  formatPublishedAt: (publishedAt: string) => string;
  onApply: (ids: string[], policy: RetentionPolicy) => Promise<RetentionBatchOutcome[]>;
  onReload: () => Promise<void> | void;
}

interface BatchResult { policy: RetentionPolicy; summary: RetentionBatchSummary }

export function RetentionReviewView({ data, formatPublishedAt, onApply, onReload }: RetentionReviewViewProps) {
  const [filters, setFilters] = useState<RetentionReviewFilters>(DEFAULT_RETENTION_REVIEW_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingPolicy, setPendingPolicy] = useState<RetentionPolicy | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState("");

  const filtered = useMemo(() => filterRetentionReviewItems(data.items, filters), [data.items, filters]);
  const { page: currentPage, pageCount, pageItems } = paginate(filtered, page);
  const itemsById = useMemo(() => new Map(data.items.map(item => [item.id, item])), [data.items]);
  const selectedItems = useMemo(() => [...selected].map(id => itemsById.get(id)).filter((item): item is RetentionReviewItem => !!item), [selected, itemsById]);
  const selection = summarizeSelection(selectedItems);
  const blockReason = selection.total > 0 ? autoCleanupBlockReason(selection) : null;
  const totals = summarizeSelection(data.items);
  const years = academicYearOptions(data.items);
  const departments = departmentOptions(data.items);
  const allPageSelected = pageItems.length > 0 && pageItems.every(item => selected.has(item.id));

  // 切換篩選或頁面時一律清除選取，避免選到看不見的公告。
  const changeFilters = (next: Partial<RetentionReviewFilters>) => { setFilters(current => ({ ...current, ...next })); setPage(1); setSelected(new Set()); };
  const changePage = (next: number) => { setPage(next); setSelected(new Set()); };
  const toggle = (id: string, checked: boolean) => setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  const selectPage = () => setSelected(new Set(pageItems.map(item => item.id)));
  const clearSelection = () => setSelected(new Set());

  const openConfirm = (policy: RetentionPolicy, ids = [...selected]) => { setError(""); setPendingIds(ids); setPendingPolicy(policy); };
  const pendingItems = pendingIds.map(id => itemsById.get(id)).filter((item): item is RetentionReviewItem => !!item);
  const pendingSummary = summarizeSelection(pendingItems);
  // 重試時，項目可能已不在待審清單中（例如已被他人設定）；寫入時仍會在交易中重新判斷。
  const pendingCount = pendingIds.length;
  const confirmDisabled = submitting || !pendingPolicy || pendingCount === 0 || !canSubmitRetentionBatch(pendingPolicy, pendingSummary);

  const submit = async () => {
    if (!pendingPolicy || confirmDisabled || submittingRef.current) return;
    submittingRef.current = true;
    const policy = pendingPolicy;
    const ids = pendingIds;
    setSubmitting(true); setError(""); setProgress(`處理中，共 ${ids.length} 篇，請勿關閉頁面…`);
    try {
      const outcomes = await onApply(ids, policy);
      setResult({ policy, summary: summarizeRetentionOutcomes(outcomes) });
      setPendingPolicy(null); setPendingIds([]); setSelected(new Set());
      await onReload();
    } catch {
      setError("保存方式設定未完成，請確認網路與權限後再試一次。已完成的公告不會重複修改。");
    } finally { submittingRef.current = false; setSubmitting(false); setProgress(""); }
  };

  return <main className={styles.page}>
    <header><div>
      <Link href="/admin"><ArrowLeft />返回行政管理</Link>
      <p>系統管理員專用</p>
      <h1>舊公告保存方式審查</h1>
      <span>為尚未審查的舊公告設定保存方式。</span>
      <strong className={styles.notEnabled} role="note">ⓘ 目前只記錄保存方式，自動清理功能尚未啟用，不會刪除任何公告。</strong>
    </div></header>
    <div className={styles.shell}>
      <section className={styles.summary} aria-label="審查摘要">
        <div><strong>{totals.total}</strong><span>篇可在此審查</span></div>
        <div><strong>{totals.dated}</strong><span>有明確期限</span></div>
        <div><strong>{totals.undated}</strong><span>無明確期限</span></div>
        <div><strong>{totals.invalid}</strong><span>日期異常</span></div>
      </section>
      <ul className={styles.categoryGuide} aria-label="期限分類說明">
        <li><span className={styles.dated}>有明確期限</span>可設定自動清理或長期保留；未來以最後活動或截止日起算。</li>
        <li><span className={styles.undated}>無明確期限</span>發布日期有效即可設定自動清理；未來依發布日期計算清理時間，標題或內文中的日期不會自動辨識。</li>
        <li><span className={styles.invalid}>日期異常</span>暫不允許自動清理，需先確認日期資料；可改設長期保留。</li>
      </ul>
      <p className={styles.hint} aria-label="公告總數分類">全部公告 {data.totalCount} 篇：尚未審查 {data.items.length + data.unlistableCount} 篇（可在此審查 {data.items.length}、資料格式異常 {data.unlistableCount}）、已審查 {data.reviewedCount} 篇、永久刪除進行中 {data.deletingCount} 篇。</p>
      {data.unlistableCount > 0 && <details className={styles.warning}>
        <summary>另有 {data.unlistableCount} 篇尚未審查的公告資料格式異常，無法在此設定。這些公告維持「尚未審查」，不會被自動清理；請將下列公告交由系統維護者檢查（點此查看）。</summary>
        <ul className={styles.unlistable}>{data.unlistable.map(entry => <li key={entry.id}><strong>{entry.title ?? "（無標題）"}</strong><span>公告 ID：{entry.id}</span><span>原因：{entry.reasons.join("、")}</span></li>)}</ul>
      </details>}

      <section className={styles.filters} aria-label="篩選">
        <label>期限分類<select value={filters.deadline} onChange={event => changeFilters({ deadline: event.target.value as DeadlineFilter })}><option value="all">全部</option><option value="dated">有明確期限</option><option value="undated">無明確期限</option><option value="invalid">日期異常</option></select></label>
        <label>發布單位<select value={filters.department} onChange={event => changeFilters({ department: event.target.value })}><option value="all">全部單位</option>{departments.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>學年度<select value={String(filters.academicYear)} onChange={event => changeFilters({ academicYear: event.target.value === "all" ? "all" : Number(event.target.value) })}><option value="all">不限</option>{years.map(value => <option key={value} value={value}>{value} 學年度</option>)}</select></label>
        <label className={styles.search}>標題關鍵字<span><Search aria-hidden="true" /><Input value={filters.query} onChange={event => changeFilters({ query: event.target.value })} placeholder="搜尋公告標題" /></span></label>
      </section>

      <section className={styles.toolbar} aria-label="選取與設定">
        <div className={styles.selectionRow}>
          <span className={styles.count} aria-live="polite">已選取 {selection.total} 篇{selection.total > 0 && `（有期限 ${selection.dated}、無期限 ${selection.undated}、日期異常 ${selection.invalid}）`}</span>
          <Button variant="outline" size="sm" onClick={selectPage} disabled={pageItems.length === 0 || allPageSelected || submitting}>選取本頁全部（{pageItems.length}）</Button>
          <Button variant="outline" size="sm" onClick={clearSelection} disabled={selection.total === 0 || submitting}>清除選取</Button>
        </div>
        <small className={styles.hint}>只能選取本頁公告；切換篩選條件或頁面時，會自動清除選取。</small>
        <div className={styles.actions}>
          <Button className={styles.primary} onClick={() => openConfirm("autoCleanup")} disabled={selection.total === 0 || submitting}>設為「{RETENTION_POLICY_LABELS.autoCleanup}」</Button>
          <Button className={styles.primary} onClick={() => openConfirm("longTerm")} disabled={selection.total === 0 || submitting}>設為「{RETENTION_POLICY_LABELS.longTerm}」</Button>
        </div>
        {blockReason && <p className={styles.block} role="status">{blockReason}</p>}
        <small className={styles.hint}>不想現在決定的公告，不勾選即可（暫不處理），會維持「尚未審查」。</small>
      </section>

      {result && <ResultPanel result={result} onRetry={() => openConfirm(result.policy, result.summary.retryableIds)} onDismiss={() => setResult(null)} disabled={submitting} />}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {data.items.length === 0 ? <p className={styles.empty}>{data.unlistableCount > 0 ? "目前沒有可在此審查的公告（另有格式異常公告，見上方提示）。" : "所有公告都已設定保存方式。"}</p>
        : filtered.length === 0 ? <p className={styles.empty}>沒有符合篩選條件的公告。</p>
        : <ul className={styles.list} aria-label="尚未審查的公告">{pageItems.map(item => <ReviewRow key={item.id} item={item} checked={selected.has(item.id)} disabled={submitting} onToggle={toggle} formatPublishedAt={formatPublishedAt} />)}</ul>}

      {filtered.length > RETENTION_REVIEW_PAGE_SIZE && <nav className={styles.pager} aria-label="分頁">
        <Button variant="outline" size="sm" onClick={() => changePage(currentPage - 1)} disabled={currentPage <= 1 || submitting}>上一頁</Button>
        <span>第 {currentPage} / {pageCount} 頁 · 共 {filtered.length} 篇</span>
        <Button variant="outline" size="sm" onClick={() => changePage(currentPage + 1)} disabled={currentPage >= pageCount || submitting}>下一頁</Button>
      </nav>}
    </div>

    <Dialog open={!!pendingPolicy} onOpenChange={open => { if (!open && !submitting) { setPendingPolicy(null); setPendingIds([]); } }}>
      <DialogContent showCloseButton={!submitting}>
        {pendingPolicy && <>
          <DialogHeader>
            <DialogTitle>確認設定保存方式</DialogTitle>
            <DialogDescription>本次將為 {pendingCount} 篇公告設定保存方式。此操作不會立即刪除公告，目前自動清理功能尚未啟用。</DialogDescription>
          </DialogHeader>
          <dl className={styles.confirmList}>
            <div><dt>保存方式</dt><dd>{RETENTION_POLICY_LABELS[pendingPolicy]}</dd></div>
            <div><dt>選取總數</dt><dd>{pendingCount} 篇</dd></div>
            <div><dt>有明確期限</dt><dd>{pendingSummary.dated} 篇</dd></div>
            <div><dt>無明確期限</dt><dd>{pendingSummary.undated} 篇</dd></div>
            <div><dt>日期異常</dt><dd>{pendingSummary.invalid} 篇</dd></div>
          </dl>
          {pendingPolicy === "autoCleanup" && pendingSummary.undated > 0 && pendingSummary.invalid === 0 && <p className={styles.hint}>無明確期限的 {pendingSummary.undated} 篇，未來將依發布日期計算清理時間；標題或內文中的日期不會自動辨識。</p>}
          {pendingPolicy === "autoCleanup" && pendingSummary.invalid > 0 && <p className={styles.block} role="alert">包含 {pendingSummary.invalid} 篇日期異常的公告，不能設定「依公告期限自動清理」。請返回取消選取並先確認日期資料，或改設「長期保留」。</p>}
          <p className={styles.hint}>已被其他人設定保存方式的公告會略過，不會被覆蓋。</p>
          {progress && <p className={styles.hint} aria-live="polite">{progress}</p>}
          <div className={styles.dialogActions}>
            <Button variant="outline" onClick={() => { setPendingPolicy(null); setPendingIds([]); }} disabled={submitting}>返回</Button>
            <Button className={styles.primary} onClick={submit} disabled={confirmDisabled}>{submitting ? "設定中…" : "確認設定"}</Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </main>;
}

function ReviewRow({ item, checked, disabled, onToggle, formatPublishedAt }: { item: RetentionReviewItem; checked: boolean; disabled: boolean; onToggle: (id: string, checked: boolean) => void; formatPublishedAt: (value: string) => string }) {
  const effective = item.effective;
  const lastDate = effective.kind === "dated" ? formatReviewDate(effective.lastDate) : effective.kind === "undated" ? "—（依發布日期計算）" : "—";
  const badge = effective.kind === "dated" ? { className: styles.dated, label: "有明確期限" } : effective.kind === "undated" ? { className: styles.undated, label: "無明確期限" } : { className: styles.invalid, label: "日期異常" };
  const checkboxId = `review-${item.id}`;
  return <li className={checked ? styles.checked : undefined}>
    <Checkbox id={checkboxId} checked={checked} disabled={disabled} onCheckedChange={value => onToggle(item.id, value === true)} aria-label={`選取「${item.title}」`} />
    <label htmlFor={checkboxId} className={styles.rowBody}>
      <span className={styles.rowMeta}><span>{item.department}</span><span>{item.academicYear} 學年度</span><span>發布 {formatPublishedAt(item.publishedAt)}</span>{item.publicationStatus === "withdrawn" && <span>已下架</span>}</span>
      <strong>{item.title}</strong>
      <span className={styles.rowFacts}>
        <span className={badge.className}>{badge.label}</span>
        <span>最後有效日期：{lastDate}</span>
        <span>目前：{RETENTION_POLICY_LABELS.unreviewed}</span>
      </span>
      {effective.kind === "invalid" && <small className={styles.invalidNote}>{effective.reason}，暫不允許自動清理。</small>}
    </label>
  </li>;
}

function ResultPanel({ result, onRetry, onDismiss, disabled }: { result: BatchResult; onRetry: () => void; onDismiss: () => void; disabled: boolean }) {
  const { summary } = result;
  return <section className={styles.result} role="status" aria-label="設定結果">
    <h2>設定結果：{RETENTION_POLICY_LABELS[result.policy]}</h2>
    <p>成功 <strong>{summary.success}</strong> 篇 · 略過 <strong>{summary.skipped}</strong> 篇 · 失敗 <strong>{summary.failed}</strong> 篇</p>
    {summary.stopped && <p className={styles.block}>因登入狀態或網路／服務問題，已停止處理其餘公告。請確認網路連線並重新登入後，再重試失敗的公告；重試時會重新確認公告狀態與權限。</p>}
    {(summary.failedByReason.notAdmin ?? 0) > 0 && <p className={styles.block}>目前帳號已不是啟用中的系統管理員，其餘公告未修改。請確認權限後重新整理頁面。</p>}
    {summary.skipped > 0 && <ul>{Object.entries(summary.skippedByReason).map(([reason, count]) => <li key={reason}>略過 {count} 篇：{RETENTION_SKIP_REASON_LABELS[reason as keyof typeof RETENTION_SKIP_REASON_LABELS]}</li>)}</ul>}
    {summary.failed > 0 && <ul>{Object.entries(summary.failedByReason).map(([reason, count]) => <li key={reason}>失敗 {count} 篇：{RETENTION_FAIL_REASON_LABELS[reason as keyof typeof RETENTION_FAIL_REASON_LABELS]}</li>)}</ul>}
    <div className={styles.resultActions}>
      {summary.retryableIds.length > 0 && <Button variant="outline" size="sm" onClick={onRetry} disabled={disabled}>重新嘗試失敗的 {summary.retryableIds.length} 篇</Button>}
      <Button variant="ghost" size="sm" onClick={onDismiss} disabled={disabled}>關閉結果</Button>
    </div>
  </section>;
}
