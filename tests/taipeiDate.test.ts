import test from "node:test";
import assert from "node:assert/strict";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { deadlineRelativeLabel, deadlineUrgency, nextWeekEvents, weekBounds, weeklyEvents } from "../lib/announcementLogic.ts";
import { calendarDateKey, millisecondsUntilNextTaipeiMidnight, taipeiDateKey } from "../lib/taipeiDate.ts";

const range = (now: Date) => {
  const { start, end } = weekBounds(now);
  return [calendarDateKey(start), calendarDateKey(end)];
};

test("10/17 23:59 到 10/18 00:01 依臺灣時間切換新週", () => {
  assert.deepEqual(range(new Date("2026-10-17T23:59:00+08:00")), ["2026-10-11", "2026-10-17"]);
  assert.deepEqual(range(new Date("2026-10-18T00:01:00+08:00")), ["2026-10-18", "2026-10-24"]);
});

test("10/18 到 10/24 都維持星期日至星期六的同一週", () => {
  for (const value of ["2026-10-18T00:01:00+08:00", "2026-10-21T12:00:00+08:00", "2026-10-24T23:59:00+08:00"]) {
    assert.deepEqual(range(new Date(value)), ["2026-10-18", "2026-10-24"]);
  }
});

test("10/24 23:59 到 10/25 00:01 正確切換下一週", () => {
  assert.deepEqual(range(new Date("2026-10-24T23:59:00+08:00")), ["2026-10-18", "2026-10-24"]);
  assert.deepEqual(range(new Date("2026-10-25T00:01:00+08:00")), ["2026-10-25", "2026-10-31"]);
});

test("臺灣週次可正確跨月與跨年", () => {
  assert.deepEqual(range(new Date("2026-12-31T23:59:00+08:00")), ["2026-12-27", "2027-01-02"]);
  assert.deepEqual(range(new Date("2027-01-01T00:01:00+08:00")), ["2026-12-27", "2027-01-02"]);
  assert.deepEqual(range(new Date("2027-01-03T00:01:00+08:00")), ["2027-01-03", "2027-01-09"]);
});

test("UTC、美國與臺灣裝置時區得到相同臺灣日期及週次", () => {
  const original = process.env.TZ;
  const instant = new Date("2026-10-17T16:01:00.000Z");
  try {
    const results = ["UTC", "America/Los_Angeles", "Asia/Taipei"].map(zone => {
      process.env.TZ = zone;
      return { date: taipeiDateKey(instant), week: range(instant) };
    });
    assert.deepEqual(results, Array.from({ length: 3 }, () => ({ date: "2026-10-18", week: ["2026-10-18", "2026-10-24"] })));
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("已結束、當日、跨週及下週活動依臺灣日期正確分流", () => {
  const item = {
    ...mockAnnouncements[0],
    importantEvents: [
      { date: "2026-10-17", title: "已結束" },
      { date: "2026-10-18", title: "當日活動" },
      { date: "2026-10-17", endDate: "2026-10-19", title: "跨週活動" },
      { date: "2026-10-25", title: "下週活動" },
    ],
  };
  const now = new Date("2026-10-18T00:01:00+08:00");
  assert.deepEqual(weeklyEvents([item], now).map(event => event.title), ["跨週活動", "當日活動"]);
  assert.deepEqual(nextWeekEvents([item], now).map(event => event.title), ["下週活動"]);
});

test("今天明天與截止紅橘分級會在臺灣午夜同步更新", () => {
  const before = new Date("2026-10-17T23:59:00+08:00");
  const after = new Date("2026-10-18T00:01:00+08:00");
  assert.equal(deadlineRelativeLabel("2026-10-18", before), "明天截止");
  assert.equal(deadlineRelativeLabel("2026-10-18", after), "今天截止");
  assert.equal(deadlineUrgency("2026-10-20", before), "orange");
  assert.equal(deadlineUrgency("2026-10-20", after), "red");
});

test("下一個臺灣午夜的 timer 延遲不受裝置時區影響", () => {
  assert.equal(millisecondsUntilNextTaipeiMidnight(new Date("2026-10-17T23:59:00+08:00")), 60_000);
  assert.equal(millisecondsUntilNextTaipeiMidnight(new Date("2026-10-18T00:01:00+08:00")), 86_340_000);
});
