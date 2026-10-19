import test from "node:test";
import assert from "node:assert/strict";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { weeklyEventDisplay, weeklyEvents } from "../lib/announcementLogic.ts";

const now = new Date("2026-10-19T12:00:00+08:00");

test("單日事件維持原本日期顯示", () => {
  assert.deepEqual(weeklyEventDisplay({ date: "2026-10-22", title: "單日事件" }, now), {
    dateLabel: "10/22（四）",
    contextLabel: null,
    periodLabel: null,
  });
});

test("本週才開始的跨週事件仍顯示實際開始日期", () => {
  assert.deepEqual(weeklyEventDisplay({ date: "2026-10-20", endDate: "2026-10-30", title: "本週開始" }, now), {
    dateLabel: "明天",
    contextLabel: null,
    periodLabel: null,
  });
});

test("前一週開始且仍涵蓋本週的事件顯示持續狀態與完整期間", () => {
  assert.deepEqual(weeklyEventDisplay({ date: "2026-10-14", endDate: "2026-10-30", title: "跨週持續" }, now), {
    dateLabel: "本週持續",
    contextLabel: "跨週事項",
    periodLabel: "重要事件：10/14～10/30",
  });
});

test("跨月與跨年持續事件保留清楚的完整期間", () => {
  assert.equal(weeklyEventDisplay({ date: "2026-10-30", endDate: "2026-11-04", title: "跨月" }, new Date("2026-11-02T12:00:00+08:00")).periodLabel, "重要事件：10/30～11/4");
  assert.equal(weeklyEventDisplay({ date: "2026-12-31", endDate: "2027-01-05", title: "跨年" }, new Date("2027-01-04T12:00:00+08:00")).periodLabel, "重要事件：2026/12/31～2027/1/5");
});

test("已結束事件不標示本週持續且不進入本週事項", () => {
  const event = { date: "2026-10-14", endDate: "2026-10-18", title: "已結束" };
  assert.notEqual(weeklyEventDisplay(event, now).dateLabel, "本週持續");
  assert.equal(weeklyEvents([{ ...mockAnnouncements[0], importantEvents: [event] }], now).length, 0);
});

test("週次切換後持續標示會依新一週重新計算", () => {
  const event = { date: "2026-10-20", endDate: "2026-10-30", title: "跨週事件" };
  assert.notEqual(weeklyEventDisplay(event, new Date("2026-10-24T23:59:00+08:00")).dateLabel, "本週持續");
  assert.equal(weeklyEventDisplay(event, new Date("2026-10-25T00:01:00+08:00")).dateLabel, "本週持續");
});
