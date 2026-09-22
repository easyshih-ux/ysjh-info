import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { announcementPublisherLabel, applyAnnouncementUpdate, createAnnouncementUpdate, createFollowUp, filterManagedAnnouncements, hasAnnouncementContentChanges, resolveInitialManageDepartment, validateAnnouncementCore } from "../lib/announcementManagement.ts";
import type { Announcement } from "../lib/announcements.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("管理頁正式讀取 Firestore 且不使用 mockAnnouncements", () => {
  const page = source("app/manage/page.tsx");
  assert.match(page, /readManagedAnnouncements\(\)/);
  assert.doesNotMatch(page, /readPublicAnnouncements\(\)/);
  assert.doesNotMatch(page, /mockAnnouncements/);
});

test("管理列表依 publishedAt 新到舊並支援 department、audience、academicYear", () => {
  const items = filterManagedAnnouncements(mockAnnouncements, "全部", "", "全校教師", 115);
  assert.ok(items.every(item => item.audiences.includes("全校教師") && item.academicYear === 115));
  assert.deepEqual(items.map(item => item.publishedAt), [...items].map(item => item.publishedAt).sort().reverse());
});

test("管理更新可保存 contact 並以 deleteField 真正清除舊值", () => {
  const management = source("lib/announcementManagementFirestore.ts");
  const page = source("app/manage/page.tsx");
  assert.match(management, /contact: edited\.contact \?\? deleteField\(\)/);
  assert.match(page, /<ContactEditor item=\{editing\}/);
  assert.match(page, /formatContactCompact\(item\.contact\)/);
});

test("修正公告 patch 只包含可修改欄位並更新 updatedAt", () => {
  const original = mockAnnouncements[0];
  const patch = createAnnouncementUpdate({ ...original, title: "新標題" }, "2026-09-19T12:00:00.000Z");
  assert.equal(patch.title, "新標題");
  assert.equal(patch.updatedAt, "2026-09-19T12:00:00.000Z");
  assert.equal(patch.contentUpdatedAt, "2026-09-19T12:00:00.000Z");
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
  assert.equal(result.contentUpdatedAt, "2026-09-19T12:00:00.000Z");
});

test("正規化後沒有實質差異時不建立新的原文更新時間", () => {
  const original = structuredClone(mockAnnouncements[0]);
  const whitespaceOnly = { ...structuredClone(original), title: `  ${original.title}  `, content: `  ${original.content}  ` };
  assert.equal(hasAnnouncementContentChanges(original, whitespaceOnly), false);
  assert.equal(hasAnnouncementContentChanges(original, { ...structuredClone(original), title: "真正的新標題" }), true);
});

test("標題、對象、日期與聯絡資訊都屬於原公告內容變更", () => {
  const original = structuredClone(mockAnnouncements[0]);
  const changes: Announcement[] = [
    { ...structuredClone(original), title: "新標題" },
    { ...structuredClone(original), audiences: ["行政"] },
    { ...structuredClone(original), importantEvents: [{ date: "2026-09-30", title: "新日期" }] },
    { ...structuredClone(original), contact: { department: "訓育組", extension: "202" } },
  ];
  assert.ok(changes.every(edited => hasAnnouncementContentChanges(original, edited)));
});

test("followUp type 只接受 supplement/reminder 並產生 createdAt", () => {
  const supplement = createFollowUp("supplement", " 補充內容 ", "2026-09-19T12:00:00.000Z");
  const reminder = createFollowUp("reminder", "提醒內容", "2026-09-19T13:00:00.000Z");
  assert.equal(supplement.message, "補充內容");
  assert.equal(reminder.createdAt, "2026-09-19T13:00:00.000Z");
  assert.throws(() => createFollowUp("invalid" as "supplement", "內容", "2026-09-19T13:00:00.000Z"));
});

test("Firestore 修正使用原 ID，follow-up 改寫入安全 subcollection", () => {
  const firestore = source("lib/announcementManagementFirestore.ts");
  assert.match(firestore, /updateDoc\(/);
  assert.match(firestore, /doc\(getFirestoreClient\(\), ANNOUNCEMENTS_COLLECTION, edited\.id\)/);
  assert.match(firestore, /createAnnouncementFollowUp\(announcementId, type, message, publisher\)/);
  assert.doesNotMatch(firestore, /arrayUnion|followUps:\s*arrayUnion/);
  assert.doesNotMatch(firestore, /updatedAt: createdAt|contentUpdatedAt: createdAt/);
  assert.match(firestore, /if \(!hasAnnouncementContentChanges\(original, edited\)\) return null/);
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

test("附件管理保持唯讀且不存在 browser 刪除流程", () => {
  const page = source("app/manage/page.tsx");
  const combined = `${page}\n${source("lib/announcementManagementFirestore.ts")}`;
  assert.match(page, /公告附件（唯讀）/);
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

test("發布與管理的重要事項時間欄位只在有值時提供清除操作", () => {
  const publishPage = source("app/publish/page.tsx");
  const managePage = source("app/manage/page.tsx");
  assert.match(publishPage, /item\.time &&[\s\S]*updateImportantEvent\(index, "time", ""\)[\s\S]*清除時間/);
  assert.match(publishPage, /item\.endTime &&[\s\S]*updateImportantEvent\(index, "endTime", ""\)[\s\S]*清除時間/);
  assert.match(managePage, /entry\.time &&[\s\S]*updateEvent\(index, "time", ""\)[\s\S]*清除時間/);
  assert.match(managePage, /entry\.endTime &&[\s\S]*updateEvent\(index, "endTime", ""\)[\s\S]*清除時間/);
});

test("管理頁發布者顯示優先使用姓名、Email、發布單位且不暴露 UID", () => {
  const base = structuredClone(mockAnnouncements[0]);
  assert.equal(announcementPublisherLabel({ ...base, publisherDisplayName: "WenYi", publisherEmail: "wenyi@example.test", publisherUid: "firebase-secret-uid" }), "WenYi");
  assert.equal(announcementPublisherLabel({ ...base, publisherDisplayName: undefined, publisherEmail: "legacy@example.test", publisherUid: "firebase-secret-uid" }), "legacy@example.test");
  assert.equal(announcementPublisherLabel({ ...base, publisherDisplayName: undefined, publisherEmail: undefined, publisherUid: "firebase-secret-uid", department: "設備組" }), "設備組");
  assert.equal(announcementPublisherLabel({ ...base, publisherDisplayName: undefined, publisherEmail: undefined, publisherUid: "firebase-secret-uid", department: "" }), "歷史公告");
  const page = source("app/manage/page.tsx");
  assert.doesNotMatch(page, /舊公告（無 UID）|發布者：\{item\.publisherUid/);
});

test("歷史公告仍由 systemAdmin 全校範圍管理且一般 publisher ownership 不變", () => {
  const page = source("app/manage/page.tsx");
  assert.match(page, /managementScope === "all" && publisher\.role === "systemAdmin" \? items/);
  assert.match(page, /items\.filter\(item => item\.publisherUid === publisher\.uid\)/);
});

test("指定設備組進入管理頁時資料完成後立即套用組別篩選", () => {
  const equipment = { ...structuredClone(mockAnnouncements[0]), department: "設備組", academicYear: 115 };
  const other = { ...structuredClone(mockAnnouncements[1]), department: "教務處", academicYear: 115 };
  const initialDepartment = resolveInitialManageDepartment(null, "設備組");
  assert.equal(initialDepartment, "設備組");
  assert.deepEqual(filterManagedAnnouncements([other, equipment], initialDepartment, "", "全部", 115).map(item => item.department), ["設備組"]);
  assert.equal(resolveInitialManageDepartment("教務處", "設備組"), "教務處");
  assert.equal(filterManagedAnnouncements([other, equipment], "全部", "", "全部", 115).length, 2);
  assert.deepEqual(filterManagedAnnouncements([other, equipment], "教務處", "", "全部", 115).map(item => item.department), ["教務處"]);
  const page = source("app/manage/page.tsx");
  assert.match(page, /useState<Department \| "全部">\(publisher\.defaultDepartment\)/);
  assert.match(page, /resolveInitialManageDepartment/);
});
