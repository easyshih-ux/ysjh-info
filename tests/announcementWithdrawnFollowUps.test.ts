import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { announcementUpdateStatus } from "../lib/announcementUpdateStatus.ts";
import { activeOriginalFollowUps, isHandSlipWithdrawal, visibleWithdrawnFollowUps } from "../lib/announcementWithdrawnFollowUps.ts";
import type { FollowUp } from "../lib/announcements.ts";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";

const at = (minute: number, second = 0) => `2026-10-06T00:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;
const withdrawn = (type: "supplement" | "reminder", minutes: number | undefined, second = 0, overrides: Partial<FollowUp> = {}): FollowUp => ({ id: `${type}-${minutes}-${second}`, type, message: "不得公開的原文", createdAt: at(0), status: "withdrawn", ...(minutes === undefined ? {} : { withdrawnAt: at(minutes, second) }), ...overrides });

test("withdrawn 手滑期僅依 createdAt 與 withdrawnAt 判定，五分鐘內含邊界完全隱藏", () => {
  assert.equal(isHandSlipWithdrawal(withdrawn("supplement", 4)), true);
  assert.equal(isHandSlipWithdrawal(withdrawn("supplement", 5)), true);
  assert.equal(isHandSlipWithdrawal(withdrawn("supplement", 5, 1)), false);
  assert.deepEqual(visibleWithdrawnFollowUps([withdrawn("supplement", 4), withdrawn("reminder", 5)]), []);
});

test("超過手滑期或時間 metadata 缺失皆只保留 tombstone，並按 withdrawnAt 新到舊", () => {
  const newer = withdrawn("reminder", 9);
  const older = withdrawn("supplement", 6);
  const missingCreated = withdrawn("supplement", 7, 0, { createdAt: "" });
  const missingWithdrawn = withdrawn("reminder", undefined);
  assert.deepEqual(visibleWithdrawnFollowUps([older, newer, missingCreated, missingWithdrawn]).map(item => item.id), ["reminder-9-0", "supplement-7-0", "supplement-6-0", "reminder-undefined-0"]);
  assert.equal(isHandSlipWithdrawal(missingCreated), false);
  assert.equal(isHandSlipWithdrawal(missingWithdrawn), false);
});

test("active、無 status child、legacy 與 related 維持既有分流，withdrawn 不計 active", () => {
  const active: FollowUp = { id: "active", type: "supplement", message: "有效", createdAt: at(1), authorUid: "a", department: "教務處" };
  const legacy: FollowUp = { type: "reminder", message: "legacy", createdAt: at(2) };
  const related: FollowUp = { id: "related", type: "related", message: "related", createdAt: at(3), authorUid: "b", department: "學務處" };
  assert.deepEqual(activeOriginalFollowUps([active, legacy, related, withdrawn("supplement", 8)]).map(item => item.message), ["有效", "legacy"]);
});

test("首頁 status 與公開 tombstone 不會把 withdrawn 計入 badge count 或暴露原 message", () => {
  const announcement = { ...mockAnnouncements[0], followUpCounts: undefined, latestFollowUp: undefined, followUps: [withdrawn("supplement", 8), { type: "reminder" as const, message: "有效提醒", createdAt: at(2) }] };
  assert.deepEqual(announcementUpdateStatus(announcement).followUpCounts, { supplement: 0, reminder: 1, related: 0 });
  const component = readFileSync(new URL("../components/public-announcement-follow-ups.tsx", import.meta.url), "utf8");
  assert.match(component, /此則\{item\.type === "supplement" \? "補充" : "提醒"\}已由發布者撤回/);
  const tombstone = component.slice(component.indexOf("{withdrawn.length"), component.indexOf("\n  </>;"));
  assert.doesNotMatch(tombstone, /item\.message/);
  assert.match(component, /activeOriginalFollowUps/);
});
