import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canWithdrawManagedFollowUp } from "../lib/announcementFollowUpWithdrawal.ts";
import type { FollowUp } from "../lib/announcements.ts";

const publisher = { uid: "author-a", role: "publisher" as const };
const systemAdmin = { uid: "admin", role: "systemAdmin" as const };
const child = (type: FollowUp["type"], overrides: Partial<FollowUp> = {}): FollowUp => ({
  id: "child-1",
  type,
  message: "內容",
  createdAt: "2026-10-06T00:00:00.000Z",
  authorUid: "author-a",
  department: "教務處",
  ...overrides,
});

test("管理端撤回只開放作者或 systemAdmin 的 active child supplement/reminder", () => {
  assert.equal(canWithdrawManagedFollowUp(child("supplement"), publisher), true);
  assert.equal(canWithdrawManagedFollowUp(child("reminder"), publisher), true);
  assert.equal(canWithdrawManagedFollowUp(child("supplement", { authorUid: "other" }), systemAdmin), true);
  assert.equal(canWithdrawManagedFollowUp(child("reminder", { authorUid: "other" }), systemAdmin), true);
  assert.equal(canWithdrawManagedFollowUp(child("supplement", { authorUid: "other" }), publisher), false);
});

test("管理端撤回不因同單位或原公告作者身分放寬，withdrawn、legacy、related 一律不顯示", () => {
  assert.equal(canWithdrawManagedFollowUp(child("supplement", { authorUid: "other", department: "教務處" }), publisher), false);
  assert.equal(canWithdrawManagedFollowUp(child("reminder", { authorUid: "announcement-owner" }), publisher), false);
  assert.equal(canWithdrawManagedFollowUp(child("supplement", { status: "withdrawn" }), publisher), false);
  assert.equal(canWithdrawManagedFollowUp({ type: "supplement", message: "legacy", createdAt: "2026-10-06T00:00:00.000Z" }, publisher), false);
  assert.equal(canWithdrawManagedFollowUp(child("related"), publisher), false);
});

test("管理端撤回 UI 使用確認、wrapper、重新讀取與 withdrawn audit，不改 related 操作", () => {
  const source = readFileSync(new URL("../app/manage/announcement-details.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.confirm\(message\)/);
  assert.match(source, /await withdrawManagedFollowUp\(item\.id, value\.id, publisher\)/);
  assert.match(source, /setCurrentFollowUps\(await readAnnouncementFollowUps\(item\.id\)\)/);
  assert.match(source, /已撤回｜\{formatFollowUpType/);
  assert.match(source, /撤回時間｜\{formatDateTime\(followUp\.withdrawnAt!\)\}/);
  assert.doesNotMatch(source, /恢復補充|恢復提醒/);
  assert.match(source, /updateRelatedFollowUp/);
  assert.match(source, /deleteRelatedFollowUp/);
});
