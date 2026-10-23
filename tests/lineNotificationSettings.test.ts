import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { announcementFromFirestore } from "../lib/announcementFirestore.ts";
import { applyManagedAnnouncementSave, hasAnnouncementContentChanges, hasLineSettingChanges, normalizeLineSettings, validateAnnouncementCore } from "../lib/announcementManagement.ts";
import { createFirestoreAnnouncement } from "../lib/announcementPublishing.ts";
import { LINE_NOTIFICATION_LEVELS, needsSchoolwideAudienceReminder, resolveLineNotificationLevel, type LineNotificationLevel } from "../lib/announcements.ts";
import { formatDepartmentFullName } from "../lib/departments.ts";
import { publishDraftToAnnouncement, validateBasicDraft, type BasicAnnouncementDraft } from "../lib/publishDraft.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const draft = (overrides: Partial<BasicAnnouncementDraft> = {}): BasicAnnouncementDraft => ({ department: "資訊組", title: "雙因子驗證設定", audiences: ["全校教師"], content: "內容", attachments: [], importantEvents: [], deadlines: [], links: [], ...overrides });
const record = (overrides: Record<string, unknown> = {}) => ({ academicYear: 115, publishedAt: "2026-10-20T01:00:00.000Z", department: "資訊組", title: "公告", audiences: ["全校教師"], content: "內容", ...overrides });

test("四種通知等級正式定義，舊公告缺少欄位時預設 general", () => {
  assert.deepEqual([...LINE_NOTIFICATION_LEVELS], ["schoolwide", "required", "task", "general"]);
  assert.equal(resolveLineNotificationLevel(undefined), "general");
  assert.equal(resolveLineNotificationLevel("urgent"), "general");
  assert.equal(resolveLineNotificationLevel("task"), "task");
});

test("發布草稿保存通知等級與實際辦理對象，空白對象不寫入", () => {
  const withNote = publishDraftToAnnouncement(draft({ lineNotificationLevel: "required", audienceNote: "  尚未完成設定的同仁  " }), "id", "2026-10-20T01:00:00.000Z", 115);
  assert.equal(withNote.lineNotificationLevel, "required");
  assert.equal(withNote.audienceNote, "尚未完成設定的同仁");
  const noNote = publishDraftToAnnouncement(draft({ audienceNote: "   " }), "id", "2026-10-20T01:00:00.000Z", 115);
  assert.equal(noNote.lineNotificationLevel, "general");
  assert.ok(!("audienceNote" in noNote));
  const document = createFirestoreAnnouncement(draft({ lineNotificationLevel: "task" }), 115, "2026-10-20T01:00:00.000Z");
  assert.equal(document.lineNotificationLevel, "task");
});

test("實際辦理對象最多 40 字，通知等級必須合法", () => {
  assert.equal(validateBasicDraft(draft({ audienceNote: "對".repeat(40) })).audienceNote, undefined);
  assert.match(validateBasicDraft(draft({ audienceNote: "對".repeat(41) })).audienceNote ?? "", /不可超過 40 個字/);
  assert.ok(validateBasicDraft(draft({ lineNotificationLevel: "urgent" as LineNotificationLevel })).lineNotificationLevel);
});

test("通知等級與實際辦理對象不改變 audiences 篩選語意", () => {
  const item = publishDraftToAnnouncement(draft({ audiences: ["七年級導師"], lineNotificationLevel: "schoolwide", audienceNote: "各班導師" }), "id", "2026-10-20T01:00:00.000Z", 115);
  assert.deepEqual(item.audiences, ["七年級導師"]);
});

test("全校必讀但接收對象不是全校教師時提醒，不阻止發布", () => {
  assert.equal(needsSchoolwideAudienceReminder("schoolwide", ["七年級導師"]), true);
  assert.equal(needsSchoolwideAudienceReminder("schoolwide", ["全校教師"]), false);
  assert.equal(needsSchoolwideAudienceReminder("required", ["七年級導師"]), false);
  assert.deepEqual(validateBasicDraft(draft({ audiences: ["七年級導師"], lineNotificationLevel: "schoolwide" })), {});
});

test("Firestore parser 讀取合法新欄位，舊資料與非法值安全略過", () => {
  const item = announcementFromFirestore("a", record({ lineNotificationLevel: "schoolwide", audienceNote: "領域召集人" }))!;
  assert.equal(item.lineNotificationLevel, "schoolwide");
  assert.equal(item.audienceNote, "領域召集人");
  const legacy = announcementFromFirestore("b", record())!;
  assert.ok(!("lineNotificationLevel" in legacy));
  assert.ok(!("audienceNote" in legacy));
  const invalid = announcementFromFirestore("c", record({ lineNotificationLevel: "urgent", audienceNote: "對".repeat(41) }))!;
  assert.ok(!("lineNotificationLevel" in invalid));
  assert.ok(!("audienceNote" in invalid));
});

test("管理編輯：只改 LINE 設定不算原文更新，舊公告無欄位時不產生多餘寫入", () => {
  const original = structuredClone(mockAnnouncements[0]);
  assert.equal(hasLineSettingChanges(original, { ...structuredClone(original), lineNotificationLevel: "general" }), false);
  const edited = { ...structuredClone(original), lineNotificationLevel: "task" as const, audienceNote: "國文領域教師" };
  assert.equal(hasLineSettingChanges(original, edited), true);
  assert.equal(hasAnnouncementContentChanges(original, edited), false);
  const saved = applyManagedAnnouncementSave(original, edited, null);
  assert.equal(saved.lineNotificationLevel, "task");
  assert.equal(saved.audienceNote, "國文領域教師");
  assert.equal(saved.contentUpdatedAt, original.contentUpdatedAt);
  const cleared = applyManagedAnnouncementSave(saved, { ...saved, audienceNote: "  " }, null);
  assert.ok(!("audienceNote" in cleared));
  assert.deepEqual(normalizeLineSettings({}), { lineNotificationLevel: "general" });
  assert.match(validateAnnouncementCore({ ...original, audienceNote: "對".repeat(41) }).audienceNote ?? "", /40/);
});

test("管理更新以 deleteField 清除實際辦理對象，只改 LINE 設定不寫入原文更新欄位", () => {
  const management = source("lib/announcementManagementFirestore.ts");
  assert.match(management, /audienceNote: lineSettings\.audienceNote \?\? deleteField\(\)/);
  assert.match(management, /contentUpdatedAt \? \{ \.\.\.createAnnouncementUpdate/);
});

test("發布頁與管理編輯共用 LINE 通知設定元件", () => {
  assert.match(source("app/publish/page.tsx"), /<LineNotificationSettings idPrefix="publish"/);
  assert.match(source("app/manage/page.tsx"), /<LineNotificationSettings idPrefix=\{`edit-/);
  assert.match(source("components/line-notification-settings.tsx"), /仍可發布/);
});

test("完整處室與組別名稱沿用現有單位對照", () => {
  assert.equal(formatDepartmentFullName("資訊組"), "教務處資訊組");
  assert.equal(formatDepartmentFullName("健康中心"), "學務處健康中心");
  assert.equal(formatDepartmentFullName("教務處"), "教務處");
  assert.equal(formatDepartmentFullName("人事室"), "人事室");
  assert.equal(formatDepartmentFullName("教師會"), "教師會");
});
