import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  academicYearOptions, autoCleanupBlockReason, buildRetentionReviewData, canSubmitRetentionBatch, chunkIds, departmentOptions, evaluateRetentionWrite,
  filterRetentionReviewItems, DEFAULT_RETENTION_REVIEW_FILTERS, isEnabledSystemAdminProfile, isValidCalendarDate, lastEffectiveDateFromRaw, paginate,
  RETENTION_REVIEW_CHUNK_SIZE, RETENTION_REVIEW_PAGE_SIZE, summarizeRetentionOutcomes, summarizeSelection, type RetentionReviewItem,
  classifyRetentionTransactionError, processRetentionChunks, RetentionOperatorCheckError, retentionBatchStopped, type RetentionBatchOutcome,
} from "../lib/retentionReview.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const raw = (overrides: Record<string, unknown> = {}) => ({ academicYear: 115, publishedAt: "2026-09-01T00:00:00.000Z", department: "設備組", title: "公告", audiences: ["全校教師"], content: "內容", importantEvents: [], deadlines: [], attachments: [], links: [], followUps: [], ...overrides });
const docs = (...items: [string, Record<string, unknown>][]) => items.map(([id, data]) => ({ id, data }));
const item = (id: string, effective: RetentionReviewItem["effective"], overrides: Partial<RetentionReviewItem> = {}): RetentionReviewItem => ({ id, title: `公告 ${id}`, department: "設備組", academicYear: 115, publishedAt: "2026-09-01T00:00:00.000Z", publicationStatus: "published", effective, ...overrides });
const dated = (lastDate = "2026-10-01") => ({ kind: "dated" as const, lastDate });
const undated = { kind: "undated" as const };

test("1 114 學年度及更早的公告會列入審查，學年度選項由實際資料產生", () => {
  const data = buildRetentionReviewData(docs(["a", raw({ academicYear: 112 })], ["b", raw({ academicYear: 114 })], ["c", raw({ academicYear: 115 })]));
  assert.deepEqual(data.items.map(entry => entry.academicYear).sort(), [112, 114, 115]);
  assert.deepEqual(academicYearOptions(data.items), [115, 114, 112]);
});

test("2 缺少或不合法的 retentionPolicy 判定為尚未審查；合法值不列入", () => {
  const data = buildRetentionReviewData(docs(["missing", raw()], ["invalid", raw({ retentionPolicy: "forever" })], ["nullValue", raw({ retentionPolicy: null })], ["auto", raw({ retentionPolicy: "autoCleanup" })], ["keep", raw({ retentionPolicy: "longTerm" })]));
  assert.deepEqual(data.items.map(entry => entry.id).sort(), ["invalid", "missing", "nullValue"]);
  assert.equal(data.reviewedCount, 2);
});

test("3 最後有效日期：活動結束日（無結束日才用開始日）與截止日取最晚，不使用發布或修改日期", () => {
  assert.deepEqual(lastEffectiveDateFromRaw(raw({ importantEvents: [{ date: "2026-09-10", endDate: "2026-09-20", title: "a" }, { date: "2026-10-05", title: "b" }], deadlines: [{ date: "2026-09-30", label: "c" }] })), dated("2026-10-05"));
  assert.deepEqual(lastEffectiveDateFromRaw(raw({ importantEvents: [{ date: "2026-09-10", endDate: "2026-12-01", title: "a" }], deadlines: [{ date: "2026-11-30", label: "c" }] })), dated("2026-12-01"));
  assert.deepEqual(lastEffectiveDateFromRaw(raw({ deadlines: [{ date: "2026-11-13", label: "c" }] })), dated("2026-11-13"));
  assert.deepEqual(lastEffectiveDateFromRaw(raw({ importantEvents: [{ date: "2026-09-10", endDate: "", title: "a" }] })), dated("2026-09-10"));
  assert.deepEqual(lastEffectiveDateFromRaw(raw({ publishedAt: "2027-01-01T00:00:00.000Z", contentUpdatedAt: "2027-02-01T00:00:00.000Z", latestFollowUp: { createdAt: "2027-03-01" } })), undated);
  assert.deepEqual(lastEffectiveDateFromRaw(raw({ importantEvents: undefined, deadlines: undefined })), undated);
});

test("4 沒有日期的公告不可批次設定 autoCleanup，可設定 longTerm", () => {
  const summary = summarizeSelection([item("a", undated)]);
  assert.match(autoCleanupBlockReason(summary) ?? "", /1 篇無明確期限/);
  assert.equal(canSubmitRetentionBatch("autoCleanup", summary), false);
  assert.equal(canSubmitRetentionBatch("longTerm", summary), true);
  assert.deepEqual(evaluateRetentionWrite(true, raw(), "autoCleanup"), { ok: false, reason: "noValidDate" });
  assert.deepEqual(evaluateRetentionWrite(true, raw(), "longTerm"), { ok: true });
});

test("5 日期格式錯誤採保守處理：判定異常，不推算日期，不可設定 autoCleanup", () => {
  const invalidCases = [
    { importantEvents: [{ date: "2026/11/01", title: "a" }] },
    { importantEvents: [{ date: "2026-02-30", title: "a" }] },
    { importantEvents: [{ date: "", title: "a" }] },
    { importantEvents: [{ title: "a" }] },
    { importantEvents: [{ date: "2026-09-10", endDate: "2026-13-01", title: "a" }] },
    { importantEvents: [{ date: "2026-09-10", endDate: "2026-09-01", title: "a" }] },
    { importantEvents: [{ date: "2026-09-10", title: "a" }, "壞資料"] },
    { importantEvents: "2026-09-10" },
    { deadlines: [{ date: "11/13", label: "c" }] },
    { deadlines: [{ date: 20261113, label: "c" }] },
    { deadlines: { date: "2026-11-13" } },
  ];
  for (const overrides of invalidCases) {
    const result = lastEffectiveDateFromRaw(raw(overrides));
    assert.equal(result.kind, "invalid", JSON.stringify(overrides));
    assert.deepEqual(evaluateRetentionWrite(true, raw(overrides), "autoCleanup"), { ok: false, reason: "noValidDate" });
    assert.deepEqual(evaluateRetentionWrite(true, raw(overrides), "longTerm"), { ok: true });
  }
  // 讀取顯示流程會略過異常結束日；審查判斷不得因此退回較早的開始日。
  assert.equal(lastEffectiveDateFromRaw(raw({ importantEvents: [{ date: "2026-09-10", endDate: "not-a-date", title: "a" }] })).kind, "invalid");
  assert.equal(isValidCalendarDate("2028-02-29"), true);
  assert.equal(isValidCalendarDate("2026-02-29"), false);
});

test("6 有明確日期的公告可以設定 autoCleanup", () => {
  const summary = summarizeSelection([item("a", dated()), item("b", dated("2026-12-01"))]);
  assert.equal(autoCleanupBlockReason(summary), null);
  assert.equal(canSubmitRetentionBatch("autoCleanup", summary), true);
  assert.deepEqual(evaluateRetentionWrite(true, raw({ deadlines: [{ date: "2026-11-13", label: "c" }] }), "autoCleanup"), { ok: true });
});

test("7～8 混合選取（含全選本頁）時，自動清理整次被阻止；長期保留不受影響", () => {
  const pageItems = [item("a", dated()), item("b", undated), item("c", { kind: "invalid", reason: "x" }), item("d", dated())];
  const summary = summarizeSelection(pageItems);
  assert.deepEqual(summary, { total: 4, dated: 2, undated: 2 });
  assert.match(autoCleanupBlockReason(summary) ?? "", /2 篇無明確期限/);
  assert.equal(canSubmitRetentionBatch("autoCleanup", summary), false);
  assert.equal(canSubmitRetentionBatch("longTerm", summary), true);
  assert.equal(canSubmitRetentionBatch("longTerm", summarizeSelection([])), false);
});

test("9～10 交易中重新判斷：已有保存方式不覆蓋、刪除中與不存在略過", () => {
  assert.deepEqual(evaluateRetentionWrite(true, raw({ retentionPolicy: "longTerm", deadlines: [{ date: "2026-11-13", label: "c" }] }), "autoCleanup"), { ok: false, reason: "alreadyReviewed" });
  assert.deepEqual(evaluateRetentionWrite(true, raw({ retentionPolicy: "autoCleanup" }), "longTerm"), { ok: false, reason: "alreadyReviewed" });
  assert.deepEqual(evaluateRetentionWrite(true, raw({ deletionStartedAt: "2026-11-06T00:00:00.000Z" }), "longTerm"), { ok: false, reason: "deleting" });
  assert.deepEqual(evaluateRetentionWrite(true, raw({ deletionStartedAt: null }), "longTerm"), { ok: false, reason: "deleting" });
  assert.deepEqual(evaluateRetentionWrite(false, null, "longTerm"), { ok: false, reason: "missing" });
  // 非法的既有值仍屬尚未審查，可以被設定為合法值。
  assert.deepEqual(evaluateRetentionWrite(true, raw({ retentionPolicy: "forever" }), "longTerm"), { ok: true });
});

test("清單：排除刪除中、包含已下架、格式異常者計入無法列出數量", () => {
  const data = buildRetentionReviewData(docs(
    ["ok", raw()],
    ["withdrawn", raw({ publicationStatus: "withdrawn" })],
    ["deleting", raw({ deletionStartedAt: "2026-11-06T00:00:00.000Z" })],
    ["noTitle", raw({ title: "" })],
    ["badYear", raw({ academicYear: "115" })],
    ["reviewedBroken", raw({ title: "", retentionPolicy: "longTerm" })],
  ));
  assert.deepEqual(data.items.map(entry => entry.id).sort(), ["ok", "withdrawn"]);
  assert.equal(data.items.find(entry => entry.id === "withdrawn")?.publicationStatus, "withdrawn");
  assert.equal(data.deletingCount, 1);
  assert.equal(data.unlistableCount, 2);
  assert.equal(data.reviewedCount, 1);
});

test("篩選、排序與每頁 50 筆分頁", () => {
  const items = [
    item("old", dated(), { academicYear: 113, publishedAt: "2024-09-01T00:00:00.000Z", department: "教學組", title: "舊段考" }),
    item("new", undated, { publishedAt: "2026-10-01T00:00:00.000Z", title: "新研習" }),
    item("mid", dated(), { publishedAt: "2025-10-01T00:00:00.000Z", title: "段考範圍" }),
  ];
  assert.deepEqual(filterRetentionReviewItems(items, DEFAULT_RETENTION_REVIEW_FILTERS).map(entry => entry.id), ["new", "mid", "old"]);
  assert.deepEqual(filterRetentionReviewItems(items, { ...DEFAULT_RETENTION_REVIEW_FILTERS, deadline: "dated" }).map(entry => entry.id), ["mid", "old"]);
  assert.deepEqual(filterRetentionReviewItems(items, { ...DEFAULT_RETENTION_REVIEW_FILTERS, deadline: "undated" }).map(entry => entry.id), ["new"]);
  assert.deepEqual(filterRetentionReviewItems(items, { ...DEFAULT_RETENTION_REVIEW_FILTERS, department: "教學組" }).map(entry => entry.id), ["old"]);
  assert.deepEqual(filterRetentionReviewItems(items, { ...DEFAULT_RETENTION_REVIEW_FILTERS, academicYear: 113 }).map(entry => entry.id), ["old"]);
  assert.deepEqual(filterRetentionReviewItems(items, { ...DEFAULT_RETENTION_REVIEW_FILTERS, query: "段考" }).map(entry => entry.id), ["mid", "old"]);
  assert.deepEqual(departmentOptions(items).sort(), ["教學組", "設備組"].sort());
  const many = Array.from({ length: 120 }, (_, index) => index);
  assert.equal(RETENTION_REVIEW_PAGE_SIZE, 50);
  assert.deepEqual(paginate(many, 1).pageItems.length, 50);
  assert.deepEqual(paginate(many, 3), { page: 3, pageCount: 3, pageItems: many.slice(100) });
  assert.equal(paginate(many, 99).page, 3);
  assert.equal(paginate([], 1).pageCount, 1);
});

test("11 只有啟用中的 systemAdmin 才通過交易內身分檢查", () => {
  assert.equal(isEnabledSystemAdminProfile({ role: "systemAdmin", enabled: true }), true);
  for (const profile of [{ role: "publisher", enabled: true }, { role: "systemAdmin", enabled: false }, { role: "systemAdmin" }, null, undefined]) assert.equal(isEnabledSystemAdminProfile(profile), false);
});

test("13 成功、略過、失敗數量與可重試項目統計正確；14 重複 ID 不重複處理", () => {
  const summary = summarizeRetentionOutcomes([
    { id: "a", status: "success" }, { id: "b", status: "success" },
    { id: "c", status: "skipped", reason: "alreadyReviewed" }, { id: "d", status: "skipped", reason: "noValidDate" }, { id: "e", status: "skipped", reason: "alreadyReviewed" },
    { id: "f", status: "failed", reason: "writeFailed" },
  ]);
  assert.equal(summary.success, 2);
  assert.equal(summary.skipped, 3);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.skippedByReason, { alreadyReviewed: 2, noValidDate: 1 });
  assert.deepEqual(summary.failedByReason, { writeFailed: 1 });
  assert.deepEqual(summary.retryableIds, ["f"]);
  assert.equal(RETENTION_REVIEW_CHUNK_SIZE, 50);
  assert.deepEqual(chunkIds(["a", "b", "a", "c", "d"], 2), [["a", "b"], ["c", "d"]]);
  assert.equal(chunkIds(Array.from({ length: 120 }, (_, index) => `id${index}`)).length, 3);
});

test("頁面：前端 systemAdmin 檢查、入口只給 systemAdmin、切換篩選與分頁會清除選取", () => {
  const page = source("app/admin/retention-review/page.tsx");
  assert.match(page, /<AdminAuthGuard><RetentionReviewGate \/><\/AdminAuthGuard>/);
  assert.match(page, /if \(publisher\.role !== "systemAdmin"\) \{\n\s*return [^\n]*此功能僅供系統管理員使用/);
  const admin = source("app/admin/page.tsx");
  assert.match(admin, /\{isSystemAdmin && <Link href="\/admin\/retention-review">/);
  const view = source("app/admin/retention-review/retention-review-view.tsx");
  assert.match(view, /const changeFilters = [^\n]*setSelected\(new Set\(\)\)/);
  assert.match(view, /const changePage = [^\n]*setSelected\(new Set\(\)\)/);
  assert.match(view, /只能選取本頁公告；切換篩選條件或頁面時，會自動清除選取/);
  assert.match(view, /此操作不會立即刪除公告，目前自動清理功能尚未啟用/);
  assert.match(view, /submittingRef\.current/);
  assert.doesNotMatch(view, /Trash2|deleteDoc|永久刪除公告/);
});

test("12 批次寫入只更新 retentionPolicy，並在交易中先讀後寫；不含排程或刪除", () => {
  const firestore = source("lib/retentionReviewFirestore.ts");
  assert.match(firestore, /runTransaction\(database, async transaction =>/);
  const updates = firestore.match(/transaction\.update\([^)]*\)/g) ?? [];
  assert.deepEqual(updates, ["transaction.update(references[index], { retentionPolicy: policy })"]);
  assert.ok(firestore.indexOf("transaction.get(") < firestore.indexOf("transaction.update("));
  assert.doesNotMatch(firestore, /transaction\.(set|delete)\(|deleteDoc|writeBatch|setDoc|onSchedule/);
  assert.doesNotMatch(source("lib/retentionReview.ts"), /deleteDoc|onSchedule|transaction\.delete/);
});

// ===== Gate 3C：統計一致性與失敗／重試安全性 =====

test("3C-1 統計：每篇文件只落入一個分類，總數恆等於各分類加總", () => {
  const data = buildRetentionReviewData(docs(
    ["ok", raw()], ["withdrawn", raw({ publicationStatus: "withdrawn" })],
    ["broken", raw({ title: "" })], ["brokenYear", raw({ academicYear: null })],
    ["reviewed", raw({ retentionPolicy: "autoCleanup" })], ["reviewedBroken", raw({ title: "", retentionPolicy: "longTerm" })],
    ["deleting", raw({ deletionStartedAt: "x" })], ["deletingReviewed", raw({ deletionStartedAt: "x", retentionPolicy: "longTerm" })], ["deletingBroken", raw({ deletionStartedAt: "x", title: "" })],
    ["invalidPolicy", raw({ retentionPolicy: "forever" })],
  ));
  assert.equal(data.totalCount, 10);
  assert.equal(data.items.length + data.unlistableCount + data.reviewedCount + data.deletingCount, data.totalCount);
  assert.deepEqual({ listed: data.items.length, unlistable: data.unlistableCount, reviewed: data.reviewedCount, deleting: data.deletingCount }, { listed: 3, unlistable: 2, reviewed: 2, deleting: 3 });
  assert.equal(new Set(data.items.map(entry => entry.id)).size, data.items.length);
  assert.deepEqual(buildRetentionReviewData([]), { totalCount: 0, items: [], unlistableCount: 0, deletingCount: 0, reviewedCount: 0 });
});

test("3C-2 錯誤分類：只有與特定公告有關的失敗可逐篇重試；登入、網路、服務與未知錯誤一律停止", () => {
  for (const code of ["permission-denied", "aborted", "failed-precondition", "invalid-argument", "not-found", "firestore/permission-denied"]) assert.equal(classifyRetentionTransactionError({ code }), "splittable", code);
  for (const code of ["unauthenticated", "firestore/unauthenticated"]) assert.equal(classifyRetentionTransactionError({ code }), "signedOut", code);
  for (const code of ["unavailable", "deadline-exceeded", "resource-exhausted", "cancelled", "internal", "unknown"]) assert.equal(classifyRetentionTransactionError({ code }), "serviceUnavailable", code);
  assert.equal(classifyRetentionTransactionError(new Error("network down")), "serviceUnavailable");
  assert.equal(classifyRetentionTransactionError(null), "serviceUnavailable");
  assert.equal(classifyRetentionTransactionError(new RetentionOperatorCheckError({ code: "permission-denied" })), "signedOut");
});

const fakeError = (code: string) => Object.assign(new Error(code), { code });
function fakeRunner(behavior: (ids: readonly string[]) => RetentionBatchOutcome[] | Error) {
  const calls: string[][] = [];
  const run = async (ids: readonly string[]) => { calls.push([...ids]); const result = behavior(ids); if (result instanceof Error) throw result; return result; };
  return { run, calls };
}
const success = (ids: readonly string[]) => ids.map((id): RetentionBatchOutcome => ({ id, status: "success" }));

test("3C-3 可拆分的整批失敗：逐篇重試，只把真正失敗者列為可重試，已成功者不重複執行", async () => {
  const runner = fakeRunner(ids => ids.length > 1 && ids.includes("bad") ? fakeError("permission-denied") : ids[0] === "bad" ? fakeError("permission-denied") : success(ids));
  const outcomes = await processRetentionChunks([["a", "bad", "c"], ["d", "e"]], runner.run);
  assert.deepEqual(outcomes.map(outcome => `${outcome.id}:${outcome.status === "failed" ? outcome.reason : outcome.status}`), ["a:success", "bad:writeFailed", "c:success", "d:success", "e:success"]);
  assert.deepEqual(runner.calls, [["a", "bad", "c"], ["a"], ["bad"], ["c"], ["d", "e"]]);
  const summary = summarizeRetentionOutcomes(outcomes);
  assert.deepEqual({ success: summary.success, failed: summary.failed, retry: summary.retryableIds, stopped: summary.stopped }, { success: 4, failed: 1, retry: ["bad"], stopped: false });
});

test("3C-4 網路或服務問題：立即停止，不逐篇重試，後續批次不執行並列為可重試", async () => {
  const runner = fakeRunner(ids => ids[0] === "c" ? fakeError("unavailable") : success(ids));
  const outcomes = await processRetentionChunks([["a", "b"], ["c", "d"], ["e", "f"]], runner.run);
  assert.deepEqual(runner.calls, [["a", "b"], ["c", "d"]], "失敗後不得逐篇重試或繼續下一批");
  assert.deepEqual(outcomes.map(outcome => `${outcome.id}:${outcome.status === "failed" ? outcome.reason : outcome.status}`), ["a:success", "b:success", "c:serviceUnavailable", "d:serviceUnavailable", "e:notProcessed", "f:notProcessed"]);
  const summary = summarizeRetentionOutcomes(outcomes);
  assert.equal(summary.stopped, true);
  assert.deepEqual(summary.retryableIds, ["c", "d", "e", "f"]);
  assert.equal(retentionBatchStopped(outcomes), true);
});

test("3C-5 登入失效或無法確認操作者身分：立即停止，不逐篇重試", async () => {
  for (const error of [fakeError("unauthenticated"), new RetentionOperatorCheckError(fakeError("permission-denied"))]) {
    const runner = fakeRunner(() => error);
    const outcomes = await processRetentionChunks([["a", "b"], ["c"]], runner.run);
    assert.equal(runner.calls.length, 1);
    assert.deepEqual(outcomes.map(outcome => outcome.status === "failed" ? outcome.reason : outcome.status), ["signedOut", "signedOut", "notProcessed"]);
  }
});

test("3C-6 逐篇重試途中遇到網路問題：停止剩餘公告，不再嘗試", async () => {
  const runner = fakeRunner(ids => ids.length > 1 ? fakeError("permission-denied") : ids[0] === "b" ? fakeError("deadline-exceeded") : success(ids));
  const outcomes = await processRetentionChunks([["a", "b", "c"], ["d"]], runner.run);
  assert.deepEqual(runner.calls, [["a", "b", "c"], ["a"], ["b"]]);
  assert.deepEqual(outcomes.map(outcome => `${outcome.id}:${outcome.status === "failed" ? outcome.reason : outcome.status}`), ["a:success", "b:serviceUnavailable", "c:notProcessed", "d:notProcessed"]);
});

test("3C-7 失去 systemAdmin 權限：後續批次不再嘗試，且不列入可重試", async () => {
  const runner = fakeRunner(ids => ids.map((id): RetentionBatchOutcome => ({ id, status: "failed", reason: "notAdmin" })));
  const outcomes = await processRetentionChunks([["a", "b"], ["c"]], runner.run);
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(outcomes.map(outcome => outcome.status === "failed" ? outcome.reason : outcome.status), ["notAdmin", "notAdmin", "notAdmin"]);
  const summary = summarizeRetentionOutcomes(outcomes);
  assert.deepEqual(summary.retryableIds, []);
  assert.equal(summary.failed, 3);
});

test("3C-8 介面：摘要顯示完整分類、停止與權限提示；確認視窗與結果文字一致", () => {
  const view = source("app/admin/retention-review/retention-review-view.tsx");
  assert.match(view, /全部公告 \{data\.totalCount\} 篇：尚未審查 \{data\.items\.length \+ data\.unlistableCount\} 篇/);
  assert.match(view, /summary\.stopped && /);
  assert.match(view, /重試時會重新確認公告狀態與權限/);
  assert.match(view, /本次將為 \{pendingCount\} 篇公告設定保存方式。此操作不會立即刪除公告，目前自動清理功能尚未啟用。/);
  assert.match(view, /設定結果：\{RETENTION_POLICY_LABELS\[result\.policy\]\}/);
  assert.match(source("lib/retentionReviewFirestore.ts"), /throw new RetentionOperatorCheckError\(error\)/);
});
