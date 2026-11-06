import test from "node:test";
import assert from "node:assert/strict";
import * as frontend from "../lib/retentionReview.ts";
import * as backend from "../functions/src/retentionCleanup.ts";

/**
 * 前後端期限分類一致性：functions/src/retentionCleanup.ts 複製了 lib/retentionReview.ts 的分類邏輯
 * （Functions 只編譯 functions/src，無法直接 import 前端 lib）。同一組資料必須得到相同結果。
 */
const base = { academicYear: 115, publishedAt: "2026-09-01T00:00:00.000Z", department: "設備組", title: "公告", content: "內容" };
const fixtures: unknown[] = [
  base,
  { ...base, importantEvents: [], deadlines: [] },
  { ...base, importantEvents: null, deadlines: null },
  { ...base, importantEvents: [{ date: "2026-09-10", endDate: "2026-09-20", title: "a" }, { date: "2026-10-05", title: "b" }], deadlines: [{ date: "2026-09-30", label: "c" }] },
  { ...base, importantEvents: [{ date: "2026-09-10", endDate: "", title: "a" }] },
  { ...base, importantEvents: [{ date: "2026-09-10", endDate: null, title: "a" }] },
  { ...base, deadlines: [{ date: "2028-02-29", label: "閏年" }] },
  { ...base, importantEvents: [{ date: "2026/11/01", title: "a" }] },
  { ...base, importantEvents: [{ date: "2026-02-30", title: "a" }] },
  { ...base, importantEvents: [{ date: "", title: "a" }] },
  { ...base, importantEvents: [{ title: "只有名稱" }] },
  { ...base, importantEvents: [{ time: "08:00", title: "只有時間" }] },
  { ...base, importantEvents: [{ date: "2026-09-10", endDate: "2026-13-01", title: "a" }] },
  { ...base, importantEvents: [{ date: "2026-09-10", endDate: "2026-09-01", title: "a" }] },
  { ...base, importantEvents: [{ date: "2026-09-10", title: "a" }, "壞資料"] },
  { ...base, importantEvents: "2026-09-10" },
  { ...base, deadlines: [{ date: "11/13", label: "c" }] },
  { ...base, deadlines: [{ date: 20261113, label: "c" }] },
  { ...base, deadlines: { date: "2026-11-13" } },
  ...[undefined, null, "", "2026", "2026-09-01", "2026-09-01 08:00", "Nov 6 2026", "2026-02-30T08:00:00Z", "2026-09-01T24:00:00Z", "2026-09-01T08:00:00", "2026-09-01T08:00:00+25:00", 1756713600000,
    "2026-09-01T08:30:00+08:00", "2026-09-01T08:30Z", "2028-02-29T23:59:59.999Z"].map(publishedAt => ({ ...base, publishedAt })),
  { ...base, publishedAt: "2026", deadlines: [{ date: "2026-11-13", label: "c" }] },
  { ...base, title: "活動統計(115/8/31至115/10/30)" },
  null,
  "不是物件",
  [],
];

test("前後端期限分類一致：相同資料得到相同分類與最後有效日期", () => {
  for (const [index, fixture] of fixtures.entries()) {
    const front = frontend.classifyRetentionDates(fixture);
    const back = backend.classifyRetentionDates(fixture);
    assert.equal(back.kind, front.kind, `#${index} ${JSON.stringify(fixture)}`);
    assert.deepEqual(back, front, `#${index} 結果（含原因文字）必須完全一致`);
    assert.deepEqual(backend.lastEffectiveDateFromRaw(fixture), frontend.lastEffectiveDateFromRaw(fixture), `#${index}`);
  }
});

test("前後端日期與時間驗證一致", () => {
  const dates = ["2026-01-31", "2028-02-29", "2026-02-29", "2026-13-01", "2026-1-1", "", null, 20260101, "2026-09-01T00:00:00Z"];
  for (const value of dates) assert.equal(backend.isValidCalendarDate(value), frontend.isValidCalendarDate(value), String(value));
  const times = ["2026-09-01T00:00:00.000Z", "2026-09-01T08:30:00+08:00", "2026-09-01T08:30Z", "2026-09-01", "2026", "2026-09-01T24:00:00Z", "2026-09-01T08:00:00", "2026-09-01T08:00:00+15:00", null, 1];
  for (const value of times) assert.equal(backend.isStrictIsoDateTime(value), frontend.isStrictIsoDateTime(value), String(value));
});

test("後端只把前端可設定自動清理的分類視為可計算期限（日期異常一律不計算）", () => {
  for (const fixture of fixtures) {
    const front = frontend.classifyRetentionDates(fixture);
    const decision = backend.evaluateRetentionCleanup({ id: "x", data: fixture === null || typeof fixture !== "object" || Array.isArray(fixture) ? fixture : { ...fixture, retentionPolicy: "autoCleanup" }, followUps: [], lineNotices: [], today: "2030-01-01" });
    if (frontend.allowsAutoCleanup(front)) assert.notEqual(decision.baseCleanupDate, null, JSON.stringify(fixture));
    else assert.equal(decision.baseCleanupDate, null, JSON.stringify(fixture));
  }
});
