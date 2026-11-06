import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { DEFAULT_RETENTION_POLICY, hasRetentionPolicyChanges, isAutoCleanupAuthorized, isRetentionPolicy, RETENTION_GRACE_DAYS, RETENTION_EXPIRY_MONTHS, retentionPolicyPatch, retentionPolicyStatus } from "../lib/announcementRetention.ts";
import { createFirestoreAnnouncement } from "../lib/announcementPublishing.ts";
import { publishDraftToAnnouncement, validateBasicDraft, type BasicAnnouncementDraft } from "../lib/publishDraft.ts";
import { announcementFromFirestore } from "../lib/announcementFirestore.ts";
import { applyManagedAnnouncementSave, hasAnnouncementContentChanges, validateAnnouncementCore } from "../lib/announcementManagement.ts";
import type { Announcement } from "../lib/announcements.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const draft = (overrides: Partial<BasicAnnouncementDraft> = {}): BasicAnnouncementDraft => ({ department: "設備組", title: "保存方式測試", audiences: ["全校教師"], content: "測試內容", attachments: [], importantEvents: [], deadlines: [], links: [], ...overrides });
const legacy = (): Announcement => {
  const item = structuredClone(mockAnnouncements[0]);
  delete item.retentionPolicy;
  return item;
};
const storedDocument = (overrides: Record<string, unknown> = {}) => ({ academicYear: 115, publishedAt: "2026-09-01T00:00:00.000Z", department: "設備組", title: "舊公告", audiences: ["全校教師"], content: "內容", importantEvents: [], deadlines: [], attachments: [], links: [], followUps: [], ...overrides });

test("保存方式只接受兩種合法值，期限常數為 3 個月加 14 天緩衝", () => {
  assert.equal(isRetentionPolicy("autoCleanup"), true);
  assert.equal(isRetentionPolicy("longTerm"), true);
  for (const value of ["unreviewed", "", "forever", null, undefined, 1]) assert.equal(isRetentionPolicy(value), false);
  assert.equal(DEFAULT_RETENTION_POLICY, "autoCleanup");
  assert.equal(RETENTION_EXPIRY_MONTHS, 3);
  assert.equal(RETENTION_GRACE_DAYS, 14);
});

test("新公告預設依公告期限自動清理，並寫入 Firestore 文件", () => {
  assert.equal(publishDraftToAnnouncement(draft(), "id", "2026-11-06T00:00:00.000Z", 115).retentionPolicy, "autoCleanup");
  const document = createFirestoreAnnouncement(draft(), 115, "2026-11-06T00:00:00.000Z", [], { uid: "u", email: "u@example.test", displayName: null });
  assert.equal(document.retentionPolicy, "autoCleanup");
});

test("新公告可切換為長期保留", () => {
  const document = createFirestoreAnnouncement(draft({ retentionPolicy: "longTerm" }), 115, "2026-11-06T00:00:00.000Z");
  assert.equal(document.retentionPolicy, "longTerm");
  assert.deepEqual(validateBasicDraft(draft({ retentionPolicy: "longTerm" })), {});
});

test("前端驗證拒絕非法保存方式", () => {
  assert.equal(validateBasicDraft(draft({ retentionPolicy: "forever" as never })).retentionPolicy, "請選擇公告保存方式");
  assert.equal(validateBasicDraft(draft()).retentionPolicy, undefined);
});

test("舊公告沒有欄位或為非法值時視為尚未審查，不授權自動清理", () => {
  const missing = announcementFromFirestore("old", storedDocument());
  assert.ok(missing);
  assert.equal("retentionPolicy" in missing, false);
  assert.equal(retentionPolicyStatus(missing.retentionPolicy), "unreviewed");
  assert.equal(isAutoCleanupAuthorized(missing), false);
  const invalid = announcementFromFirestore("bad", storedDocument({ retentionPolicy: "forever" }));
  assert.ok(invalid);
  assert.equal("retentionPolicy" in invalid, false);
  assert.equal(isAutoCleanupAuthorized(invalid), false);
  assert.equal(announcementFromFirestore("auto", storedDocument({ retentionPolicy: "autoCleanup" }))?.retentionPolicy, "autoCleanup");
  assert.equal(isAutoCleanupAuthorized({ retentionPolicy: "longTerm" }), false);
  assert.equal(isAutoCleanupAuthorized({ retentionPolicy: "autoCleanup" }), true);
});

test("編輯舊公告的其他內容不會寫入保存方式，也不會意外授權自動清理", () => {
  const original = legacy();
  const edited = { ...structuredClone(original), title: "只修正標題" };
  assert.deepEqual(retentionPolicyPatch(original, edited), {});
  assert.equal(hasRetentionPolicyChanges(original, edited), false);
  const saved = applyManagedAnnouncementSave(original, edited, "2026-11-06T00:00:00.000Z");
  assert.equal(saved.title, "只修正標題");
  assert.equal("retentionPolicy" in saved, false);
  assert.equal(isAutoCleanupAuthorized(saved), false);
  assert.deepEqual(validateAnnouncementCore(edited), {});
});

test("發布者明確選擇後才寫入保存方式；只改保存方式不算原文更新", () => {
  const original = legacy();
  const edited = { ...structuredClone(original), retentionPolicy: "longTerm" as const };
  assert.deepEqual(retentionPolicyPatch(original, edited), { retentionPolicy: "longTerm" });
  assert.equal(hasAnnouncementContentChanges(original, edited), false);
  const saved = applyManagedAnnouncementSave(original, edited, null);
  assert.equal(saved.retentionPolicy, "longTerm");
  assert.equal(saved.contentUpdatedAt, original.contentUpdatedAt);
  assert.equal(saved.contentUpdateCount, original.contentUpdateCount);
});

test("已設定的保存方式可切換，未變更時不重複寫入，也不會被刪除", () => {
  const original = { ...legacy(), retentionPolicy: "autoCleanup" as const };
  assert.deepEqual(retentionPolicyPatch(original, { ...original, retentionPolicy: "longTerm" }), { retentionPolicy: "longTerm" });
  assert.deepEqual(retentionPolicyPatch(original, { ...original }), {});
  assert.deepEqual(retentionPolicyPatch(original, { ...original, retentionPolicy: undefined }), {});
  const saved = applyManagedAnnouncementSave(original, { ...original, title: "改標題" }, "2026-11-06T00:00:00.000Z");
  assert.equal(saved.retentionPolicy, "autoCleanup");
});

test("發布頁預設自動清理、管理頁編輯器使用同一元件且不預選舊公告", () => {
  const publish = source("app/publish/page.tsx");
  assert.match(publish, /retentionPolicy: DEFAULT_RETENTION_POLICY/);
  assert.match(publish, /<RetentionPolicySettings idPrefix="publish"/);
  const manage = source("app/manage/page.tsx");
  assert.match(manage, /<RetentionPolicySettings idPrefix=\{`edit-\$\{editing\.id\}`\} value=\{editing\.retentionPolicy\}/);
  const component = source("components/retention-policy-settings.tsx");
  assert.match(component, /尚未設定保存方式/);
  const firestore = source("lib/announcementManagementFirestore.ts");
  assert.match(firestore, /\.\.\.retentionPolicyPatch\(original, edited\)/);
  assert.doesNotMatch(firestore, /retentionPolicy: deleteField\(\)/);
});

test("Gate 2 不新增自動刪除或排程", () => {
  const functions = source("functions/src/index.ts");
  assert.doesNotMatch(functions, /retentionPolicy/);
  assert.doesNotMatch(source("lib/announcementRetention.ts"), /delete|deleteDoc|onSchedule/);
});
