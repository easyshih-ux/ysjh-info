import assert from "node:assert/strict";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { announcementUpdateStatus, latestFollowUpForHomepage } from "../lib/announcementUpdateStatus.ts";

const base = () => ({ ...mockAnnouncements[0], followUps: [], contentUpdatedAt: undefined, latestFollowUp: undefined, hasRelatedFollowUp: undefined });

test("新摘要優先於 legacy followUps，並只使用最新類型", () => {
  const announcement = {
    ...base(),
    followUps: [{ type: "supplement" as const, message: "舊補充", createdAt: "2026-09-22T01:00:00.000Z" }],
    latestFollowUp: { type: "reminder" as const, createdAt: "2026-10-05T01:00:00.000Z" },
  };
  assert.deepEqual(latestFollowUpForHomepage(announcement), announcement.latestFollowUp);
});

test("無新摘要時維持 legacy followUps 相容性", () => {
  const announcement = {
    ...base(),
    followUps: [
      { type: "supplement" as const, message: "舊補充", createdAt: "2026-09-22T01:00:00.000Z" },
      { type: "reminder" as const, message: "新提醒", createdAt: "2026-09-22T02:00:00.000Z" },
    ],
  };
  assert.deepEqual(latestFollowUpForHomepage(announcement), { type: "reminder", createdAt: "2026-09-22T02:00:00.000Z" });
});

test("人工正文修正、原單位 follow-up 與其他單位補充可同時存在", () => {
  const status = announcementUpdateStatus({
    ...base(),
    contentUpdatedAt: "2026-10-05T03:00:00.000Z",
    latestFollowUp: { type: "reminder", createdAt: "2026-10-05T02:00:00.000Z" },
    hasRelatedFollowUp: true,
  });
  assert.deepEqual(status, { hasContentUpdate: true, latestFollowUp: { type: "reminder", createdAt: "2026-10-05T02:00:00.000Z" }, hasRelatedFollowUp: true });
});

test("沒有人工正文修正時，follow-up 不會誤亮公告有更新", () => {
  const status = announcementUpdateStatus({ ...base(), latestFollowUp: { type: "supplement", createdAt: "2026-10-05T02:00:00.000Z" } });
  assert.equal(status.hasContentUpdate, false);
});
