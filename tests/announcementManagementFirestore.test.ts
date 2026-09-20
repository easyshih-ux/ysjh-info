import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { applyAnnouncementUpdate, createAnnouncementUpdate, createFollowUp, filterManagedAnnouncements, validateAnnouncementCore } from "../lib/announcementManagement.ts";
import type { Announcement } from "../lib/announcements.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("管理頁正式讀取 Firestore 且不使用 mockAnnouncements", () => {
  const page = source("app/manage/page.tsx");
  assert.match(page, /readPublicAnnouncements\(\)/);
  assert.doesNotMatch(page, /mockAnnouncements/);
});

test("管理列表依 publishedAt 新到舊並支援 department、audience、academicYear", () => {
  const items = filterManagedAnnouncements(mockAnnouncements, "全部", "", "全校教師", 115);
  assert.ok(items.every(item => item.audiences.includes("全校教師") && item.academicYear === 115));
  assert.deepEqual(items.map(item => item.publishedAt), [...items].map(item => item.publishedAt).sort().reverse());
});

test("修正公告 patch 只包含可修改欄位並更新 updatedAt", () => {
  const original = mockAnnouncements[0];
  const patch = createAnnouncementUpdate({ ...original, title: "新標題" }, "2026-09-19T12:00:00.000Z");
  assert.equal(patch.title, "新標題");
  assert.equal(patch.updatedAt, "2026-09-19T12:00:00.000Z");
  assert.ok(!("id" in patch));
  assert.ok(!("publishedAt" in patch));
  assert.ok(!("attachments" in patch));
  assert.ok(!("followUps" in patch));
});

test("本機同步修正保持 ID、publishedAt、attachments 與 followUps", () => {
  const original = mockAnnouncements[0];
  const result = applyAnnouncementUpdate(original, { ...original, id: "different", publishedAt: "different", attachments: [], followUps: [], title: "修正" }, "2026-09-19T12:00:00.000Z");
  assert.equal(result.id, original.id);
  assert.equal(result.publishedAt, original.publishedAt);
  assert.deepEqual(result.attachments, original.attachments);
  assert.deepEqual(result.followUps, original.followUps);
  assert.equal(result.updatedAt, "2026-09-19T12:00:00.000Z");
});

test("followUp type 只接受 supplement/reminder 並產生 createdAt", () => {
  const supplement = createFollowUp("supplement", " 補充內容 ", "2026-09-19T12:00:00.000Z");
  const reminder = createFollowUp("reminder", "提醒內容", "2026-09-19T13:00:00.000Z");
  assert.equal(supplement.message, "補充內容");
  assert.equal(reminder.createdAt, "2026-09-19T13:00:00.000Z");
  assert.throws(() => createFollowUp("invalid" as "supplement", "內容", "2026-09-19T13:00:00.000Z"));
});

test("Firestore 修正使用原 ID 的 updateDoc，followUp 使用 arrayUnion append", () => {
  const firestore = source("lib/announcementManagementFirestore.ts");
  assert.match(firestore, /updateDoc\(/);
  assert.match(firestore, /doc\(getFirestoreClient\(\), ANNOUNCEMENTS_COLLECTION, edited\.id\)/);
  assert.match(firestore, /followUps: arrayUnion\(followUp\)/);
  assert.match(firestore, /updatedAt: createdAt/);
  assert.doesNotMatch(firestore, /setDoc|addDoc|deleteDoc/);
});

test("管理頁防止重複送出、顯示友善狀態且不暴露 Firebase error", () => {
  const page = source("app/manage/page.tsx");
  assert.match(page, /savingRef\.current/);
  assert.match(page, /儲存中…/);
  assert.match(page, /公告載入中…/);
  assert.match(page, /目前無法載入公告，請稍後再試。/);
  assert.match(page, /目前沒有已發布公告。/);
  assert.doesNotMatch(page, /permission-denied|FirebaseError/);
});

test("圖片管理保持唯讀且不存在公告刪除流程", () => {
  const page = source("app/manage/page.tsx");
  const combined = `${page}\n${source("lib/announcementManagementFirestore.ts")}`;
  assert.match(page, /公告圖片（唯讀）/);
  assert.doesNotMatch(page, /補登 Prototype 圖片|uploadBytes|deleteObject/);
  assert.doesNotMatch(combined, /deleteDoc/);
});

test("links 最多一個 primary，importantEvents 與 deadlines 仍各自驗證", () => {
  const item = structuredClone(mockAnnouncements[0]);
  item.links = [{ id: "1", label: "一", url: "https://example.com/1", type: "website", isPrimary: true }, { id: "2", label: "二", url: "https://example.com/2", type: "website", isPrimary: true }];
  assert.equal(validateAnnouncementCore(item).links, "相關網址最多只能設定一個主要連結");
  item.links = [];
  item.importantEvents = [{ date: "", title: "只有名稱" }];
  item.deadlines = [{ date: "", label: "只有期限名稱" }];
  const errors = validateAnnouncementCore(item);
  assert.ok(errors.importantEvents);
  assert.ok(errors.deadlines);
});

test("舊公告的全校教師混合對象重新儲存時會正規化", () => {
  const item = { ...structuredClone(mockAnnouncements[0]), audiences: ["全校教師", "行政"] as Announcement["audiences"] };
  assert.deepEqual(validateAnnouncementCore(item), {});
  assert.deepEqual(createAnnouncementUpdate(item, "2026-09-20T00:00:00.000Z").audiences, ["全校教師"]);
});

test("編輯清空開始與結束時間後 Firestore update 不殘留舊值", () => {
  const item = structuredClone(mockAnnouncements[0]);
  item.importantEvents = [{ date: "2026-09-23", time: "08:30", endDate: "2026-09-25", endTime: "16:00", title: "跨日活動" }];
  const edited = structuredClone(item);
  edited.importantEvents[0].time = "";
  edited.importantEvents[0].endDate = "";
  edited.importantEvents[0].endTime = "";
  const update = createAnnouncementUpdate(edited, "2026-09-20T00:00:00.000Z");
  assert.deepEqual(update.importantEvents, [{ date: "2026-09-23", title: "跨日活動" }]);
  assert.equal("time" in update.importantEvents[0], false);
  assert.equal("endDate" in update.importantEvents[0], false);
  assert.equal("endTime" in update.importantEvents[0], false);
});
