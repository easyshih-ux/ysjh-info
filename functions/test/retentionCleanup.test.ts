import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays, addCalendarMonths, baseCleanupDate, classifyRetentionDates, evaluateRetentionCleanup, latestActiveFollowUpMillis,
  RETENTION_CLEANUP_SKIP_REASONS, summarizeRetentionCleanup, taipeiDateKeyFromMillis, type RetentionCleanupInput,
} from "../src/retentionCleanup.ts";

const ts = (iso: string) => ({ toMillis: () => Date.parse(iso) });
const announcement = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115, publishedAt: "2026-01-10T02:00:00.000Z", department: "設備組", title: "公告", content: "內容",
  publisherUid: "userA", publicationStatus: "published", retentionPolicy: "autoCleanup",
  importantEvents: [], deadlines: [], attachments: [], links: [], followUps: [], ...overrides,
});
const input = (overrides: Partial<RetentionCleanupInput> & { data?: unknown } = {}): RetentionCleanupInput => ({
  id: "a1", data: announcement(), followUps: [], lineNotices: [], today: "2027-01-01", ...overrides,
});
const evaluate = (data: Record<string, unknown>, extra: Partial<RetentionCleanupInput> = {}) => evaluateRetentionCleanup(input({ data: announcement(data), ...extra }));

// ===== 日期計算 =====

test("加日曆月：月底沒有對應日期取該月最後一天，不因 Date 溢位跑到下個月", () => {
  assert.equal(addCalendarMonths("2026-01-31", 3), "2026-04-30");
  assert.equal(addCalendarMonths("2026-08-31", 3), "2026-11-30");
  assert.equal(addCalendarMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(addCalendarMonths("2027-11-30", 3), "2028-02-29", "閏年");
  assert.equal(addCalendarMonths("2027-11-29", 3), "2028-02-29");
  assert.equal(addCalendarMonths("2028-02-29", 3), "2028-05-29");
  assert.equal(addCalendarMonths("2026-10-15", 3), "2027-01-15", "跨年");
  assert.equal(addCalendarMonths("2026-12-31", 3), "2027-03-31");
  // 對照：直接用 Date 加月會溢位成 3 月 2 日。
  const naive = new Date(Date.UTC(2026, 10 + 3, 30));
  assert.equal(naive.toISOString().slice(0, 10), "2027-03-02");
  assert.throws(() => addCalendarMonths("2026-02-30", 3));
});

test("加日曆天：跨月、跨年、閏年", () => {
  assert.equal(addCalendarDays("2026-12-25", 14), "2027-01-08");
  assert.equal(addCalendarDays("2028-02-20", 14), "2028-03-05");
  assert.equal(addCalendarDays("2027-02-20", 14), "2027-03-06");
  assert.equal(addCalendarDays("2026-04-30", 14), "2026-05-14");
});

test("基本清理日期：先加 3 個月（月底取最後一天）再加 14 天；順序不同會得到不同結果", () => {
  assert.equal(baseCleanupDate("2026-01-31"), "2026-05-14");
  assert.equal(baseCleanupDate("2026-08-31"), "2026-12-14");
  assert.equal(baseCleanupDate("2026-11-30"), "2027-03-14");
  assert.equal(baseCleanupDate("2027-11-30"), "2028-03-14");
  assert.equal(baseCleanupDate("2026-10-20"), "2027-02-03", "跨年");
  // 11/17：先加月 → 2/17＋14 ＝ 3/3；若先加 14 天 → 12/1＋3 個月 ＝ 3/1。
  assert.equal(baseCleanupDate("2026-11-17"), "2027-03-03");
  assert.notEqual(baseCleanupDate("2026-11-17"), addCalendarMonths(addCalendarDays("2026-11-17", 14), 3));
});

test("UTC 與臺灣日期邊界：UTC 15:59 仍是同一天，16:00 起為臺灣隔天", () => {
  assert.equal(taipeiDateKeyFromMillis(Date.parse("2026-12-31T15:59:59.999Z")), "2026-12-31");
  assert.equal(taipeiDateKeyFromMillis(Date.parse("2026-12-31T16:00:00.000Z")), "2027-01-01");
  assert.equal(taipeiDateKeyFromMillis(Date.parse("2027-01-01T00:30:00+08:00")), "2027-01-01");
  const before = evaluate({ publishedAt: "2026-08-30T15:59:00.000Z" });
  const after = evaluate({ publishedAt: "2026-08-30T16:00:00.000Z" });
  assert.equal(before.basisDate, "2026-08-30");
  assert.equal(after.basisDate, "2026-08-31");
  assert.equal(before.baseCleanupDate, "2026-12-14");
  assert.equal(after.baseCleanupDate, "2026-12-14", "8/30 與 8/31 加 3 個月都落在 11/30");
});

test("有期限：活動結束日、只有開始日、截止日一起取最晚者", () => {
  const decision = evaluate({
    importantEvents: [{ date: "2026-09-01", endDate: "2026-09-10", title: "研習" }, { date: "2026-10-05", title: "說明會" }],
    deadlines: [{ date: "2026-09-30", label: "繳交" }],
  });
  assert.equal(decision.category, "dated");
  assert.equal(decision.basisDate, "2026-10-05");
  assert.equal(decision.baseCleanupDate, "2027-01-19");
  assert.equal(evaluate({ importantEvents: [{ date: "2026-09-01", endDate: "2026-12-01", title: "x" }], deadlines: [{ date: "2026-11-30", label: "y" }] }).basisDate, "2026-12-01");
  assert.equal(evaluate({ deadlines: [{ date: "2026-11-13", label: "y" }] }).basisDate, "2026-11-13");
});

test("無期限：以發布日期（臺灣日期）起算，不解析標題或內文日期", () => {
  const decision = evaluate({ title: "活動統計(115/8/31至115/10/30)", content: "10/30 前完成", publishedAt: "2026-11-03T01:59:00.000Z" });
  assert.equal(decision.category, "undated");
  assert.equal(decision.basisDate, "2026-11-03");
  assert.equal(decision.baseCleanupDate, "2027-02-17");
});

// ===== 更新保護 =====

test("更新保護：contentUpdatedAt、updatedAt、有效補充與相關補充取最晚者＋14 天，最終日期取較晚者", () => {
  const base = { deadlines: [{ date: "2026-09-01", label: "x" }] }; // 基本清理日期 2026-12-15
  assert.equal(evaluate(base).baseCleanupDate, "2026-12-15");
  const content = evaluate({ ...base, contentUpdatedAt: "2026-12-10T02:00:00.000Z", updatedAt: "2026-12-10T02:00:00.000Z" });
  assert.deepEqual([content.latestUpdateDate, content.protectionDate, content.finalCleanupDate], ["2026-12-10", "2026-12-24", "2026-12-24"]);
  const updatedOnly = evaluate({ ...base, updatedAt: "2026-12-20T02:00:00.000Z" });
  assert.equal(updatedOnly.finalCleanupDate, "2027-01-03");
  const supplement = evaluate(base, { followUps: [{ type: "supplement", status: "active", createdAt: ts("2026-12-25T02:00:00Z") }] });
  assert.equal(supplement.finalCleanupDate, "2027-01-08");
  const related = evaluate(base, { followUps: [{ type: "related", createdAt: ts("2026-12-01T02:00:00Z"), updatedAt: ts("2026-12-28T02:00:00Z") }] });
  assert.equal(related.latestUpdateDate, "2026-12-28", "相關補充修改時間也納入");
  const all = evaluate({ ...base, contentUpdatedAt: "2026-12-05T02:00:00Z", updatedAt: "2026-12-06T02:00:00Z" }, { followUps: [{ type: "reminder", createdAt: ts("2026-12-30T02:00:00Z") }, { type: "related", createdAt: ts("2026-12-02T02:00:00Z") }] });
  assert.equal(all.latestUpdateDate, "2026-12-30");
  const old = evaluate({ ...base, contentUpdatedAt: "2026-09-02T02:00:00Z", updatedAt: "2026-09-02T02:00:00Z" });
  assert.equal(old.finalCleanupDate, "2026-12-15", "更新保護較早時，維持基本清理日期");
});

test("撤回的補充：status 為 withdrawn 且撤回時間有效才排除；撤回資料不完整時保守視為有效", () => {
  const base = { deadlines: [{ date: "2026-09-01", label: "x" }] };
  const withdrawn = evaluate(base, { followUps: [{ type: "supplement", status: "withdrawn", withdrawnAt: ts("2026-12-30T02:00:00Z"), withdrawnBy: "u", createdAt: ts("2026-12-29T02:00:00Z") }] });
  assert.equal(withdrawn.latestUpdateDate, null);
  assert.equal(withdrawn.finalCleanupDate, "2026-12-15");
  const incomplete = evaluate(base, { followUps: [{ type: "supplement", status: "withdrawn", createdAt: ts("2026-12-29T02:00:00Z") }] });
  assert.equal(incomplete.latestUpdateDate, "2026-12-29");
  const legacyArray = evaluate({ ...base, followUps: [{ type: "supplement", message: "舊版補充", createdAt: "2026-12-27T02:00:00.000Z" }] });
  assert.equal(legacyArray.latestUpdateDate, "2026-12-27", "主文件舊版 followUps 陣列也納入");
});

test("更新後第 13 天不符合、第 14 天（清理日期當天）才符合", () => {
  const data = { deadlines: [{ date: "2026-01-01", label: "x" }], contentUpdatedAt: "2026-12-10T02:00:00.000Z", updatedAt: "2026-12-10T02:00:00.000Z" };
  assert.equal(evaluate(data).finalCleanupDate, "2026-12-24");
  assert.deepEqual(evaluate(data, { today: "2026-12-23" }).skipReasons, ["not_yet_due"]);
  assert.equal(evaluate(data, { today: "2026-12-24" }).eligible, true);
});

test("更新時間或補充提醒資料異常：保守跳過", () => {
  for (const value of ["2026-12-10", "2026/12/10 10:00", "", 1765332000000, { seconds: 1 }, { toMillis: () => Number.NaN }]) {
    assert.ok(evaluate({ contentUpdatedAt: value }).skipReasons.includes("invalid_update_time"), JSON.stringify(value));
    assert.ok(evaluate({ updatedAt: value }).skipReasons.includes("invalid_update_time"), JSON.stringify(value));
  }
  assert.equal(evaluate({ contentUpdatedAt: null, updatedAt: undefined }).skipReasons.includes("invalid_update_time"), false);
  for (const followUps of [[{ type: "supplement" }], [{ type: "supplement", createdAt: "2026/12/01" }], [{ type: "unknown", createdAt: ts("2026-12-01T00:00:00Z") }], ["壞資料"], [{ type: "related", createdAt: ts("2026-12-01T00:00:00Z"), updatedAt: "bad" }]]) {
    assert.ok(evaluate({}, { followUps }).skipReasons.includes("follow_ups_invalid"), JSON.stringify(followUps));
  }
  assert.ok(evaluate({ followUps: "舊資料" }).skipReasons.includes("follow_ups_invalid"));
  assert.deepEqual(latestActiveFollowUpMillis([]), { ok: true, milliseconds: null });
});

// ===== 安全條件 =====

test("保存方式：只有 autoCleanup 可符合；longTerm、缺少、不合法皆跳過", () => {
  assert.equal(evaluate({}).eligible, true);
  assert.deepEqual(evaluate({ retentionPolicy: "longTerm" }).skipReasons, ["retention_long_term"]);
  assert.deepEqual(evaluate({ retentionPolicy: undefined }).skipReasons, ["retention_unreviewed"]);
  assert.deepEqual(evaluate({ retentionPolicy: null }).skipReasons, ["retention_unreviewed"]);
  for (const value of ["forever", "", "AutoCleanup", 1, true]) assert.deepEqual(evaluate({ retentionPolicy: value }).skipReasons, ["retention_invalid"], JSON.stringify(value));
});

test("日期異常與無期限公告發布日期異常：跳過且不推算日期", () => {
  const badDate = evaluate({ importantEvents: [{ date: "2026-09-10", endDate: "2026-09-01", title: "x" }] });
  assert.deepEqual(badDate.skipReasons, ["invalid_schedule_dates"]);
  assert.equal(badDate.finalCleanupDate, null);
  for (const publishedAt of ["2026", "2026-09-01", "2026-09-01 08:00", undefined]) {
    const decision = evaluate({ publishedAt });
    assert.deepEqual(decision.skipReasons, ["invalid_published_at"], String(publishedAt));
    assert.equal(decision.finalCleanupDate, null);
  }
  // 有期限公告不依賴發布日期。
  assert.equal(evaluate({ publishedAt: "2026", deadlines: [{ date: "2026-01-01", label: "x" }] }).eligible, true);
});

test("催繳中、LINE pending、永久刪除中：跳過；狀態無法判斷也跳過", () => {
  assert.deepEqual(evaluate({ collectionStatus: "chasing" }).skipReasons, ["collection_in_progress"]);
  assert.deepEqual(evaluate({ collectionStatus: "unknown" }).skipReasons, ["collection_status_unknown"]);
  assert.deepEqual(evaluate({}, { lineNotices: [{ status: "sent" }, { status: "pending" }] }).skipReasons, ["line_notice_pending"]);
  assert.deepEqual(evaluate({}, { lineNotices: [{ status: "sent" }, { status: "draft" }] }).skipReasons, ["line_notice_unknown"]);
  assert.deepEqual(evaluate({}, { lineNotices: ["壞資料"] }).skipReasons, ["line_notice_unknown"]);
  assert.equal(evaluate({}, { lineNotices: [{ status: "sent" }] }).eligible, true);
  assert.deepEqual(evaluate({ deletionStartedAt: ts("2026-11-06T00:00:00Z") }).skipReasons, ["deletion_in_progress"]);
  assert.deepEqual(evaluate({ deletionStartedAt: null }).skipReasons, ["deletion_in_progress"]);
});

test("未到期跳過、到期當天符合；已下架公告依同樣規則判斷", () => {
  const data = { deadlines: [{ date: "2026-09-01", label: "x" }] };
  assert.deepEqual(evaluate(data, { today: "2026-12-14" }).skipReasons, ["not_yet_due"]);
  assert.equal(evaluate(data, { today: "2026-12-15" }).eligible, true);
  assert.equal(evaluate({ ...data, publicationStatus: "withdrawn" }, { today: "2026-12-15" }).eligible, true);
});

test("資料缺漏或無法判斷：一律跳過", () => {
  assert.deepEqual(evaluateRetentionCleanup(input({ data: null })).skipReasons, ["invalid_document"]);
  assert.deepEqual(evaluateRetentionCleanup(input({ data: "x" })).skipReasons, ["invalid_document"]);
  assert.deepEqual(evaluateRetentionCleanup(input({ id: " " })).skipReasons, ["invalid_document"]);
  assert.deepEqual(evaluate({}, { followUps: null }).skipReasons, ["follow_ups_unavailable"]);
  assert.deepEqual(evaluate({}, { lineNotices: null }).skipReasons, ["line_notices_unavailable"]);
  for (const today of ["2027/01/01", "", "2027-02-30"]) assert.deepEqual(evaluate({}, { today }).skipReasons, ["invalid_today"]);
  const many = evaluate({ retentionPolicy: "longTerm", collectionStatus: "chasing", deletionStartedAt: "x" }, { lineNotices: [{ status: "pending" }], today: "2026-01-01" });
  assert.deepEqual(many.skipReasons, ["retention_long_term", "deletion_in_progress", "collection_in_progress", "line_notice_pending", "not_yet_due"]);
  for (const reason of many.skipReasons) assert.ok(RETENTION_CLEANUP_SKIP_REASONS[reason]);
});

test("摘要統計：符合、跳過與各原因數量", () => {
  const decisions = [evaluate({}), evaluate({ retentionPolicy: "longTerm" }), evaluate({ collectionStatus: "chasing" }, { today: "2026-01-01" })];
  assert.deepEqual(summarizeRetentionCleanup(decisions), { total: 3, eligible: 1, skipped: 2, skippedByReason: { retention_long_term: 1, collection_in_progress: 1, not_yet_due: 1 } });
});

test("分類函式：真正無期限需結構化欄位為空，日期異常不得被當成無期限", () => {
  assert.equal(classifyRetentionDates(announcement()).kind, "undated");
  assert.equal(classifyRetentionDates(announcement({ importantEvents: [{ date: "", title: "x" }] })).kind, "invalid");
  assert.equal(classifyRetentionDates(announcement({ deadlines: [{ date: "11/13", label: "x" }] })).kind, "invalid");
});
