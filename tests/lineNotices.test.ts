import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import type { Announcement, FollowUp } from "../lib/announcements.ts";
import { createChaseNoticeText, createFollowUpNoticeText, createUpdateNoticeText, LINE_NOTICE_DEFAULT_CHECKED, lineNoticeFromFirestore, lineNoticeIds, lineNoticeText, pendingLineNotices, type LineNotice } from "../lib/lineNotices.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const site = "https://easyshih-ux.github.io/ysjh-info/";
const item = (overrides: Partial<Announcement> = {}): Announcement => ({ ...mockAnnouncements[0], id: "a1", department: "資訊組", title: "雙因子驗證設定", publicationStatus: "published", deadlines: [{ date: "2026-11-30", time: "12:00", label: "完成設定" }, { date: "2026-10-01", label: "已過期" }], ...overrides });
const notice = (overrides: Partial<LineNotice> = {}): LineNotice => ({ id: "publish", announcementId: "a1", type: "publish", publisherUid: "u1", status: "pending", createdBy: "u1", createdAt: "2026-10-23T01:00:00.000Z", ...overrides });

test("固定通知 ID：同一事件只會有一筆", () => {
  assert.equal(lineNoticeIds.publish(), "publish");
  assert.equal(lineNoticeIds.update(3), "update-3");
  assert.equal(lineNoticeIds.followUp("fu1"), "followup-fu1");
  assert.equal(lineNoticeIds.chase(1761184800000), "chase-1761184800000");
});

test("預設勾選：重要異動與一般補充不勾，提醒與催繳勾選", () => {
  assert.deepEqual(LINE_NOTICE_DEFAULT_CHECKED, { update: false, supplement: false, reminder: true, chase: true });
});

test("各類通知文字只呈現本次重點並附直達連結，不重複整篇公告", () => {
  const a = item();
  const update = createUpdateNoticeText(a, " 期限延後至 11/30 ", site);
  assert.match(update, /^🔄【公告更新】\n\n📢 教務處資訊組公告\n\n📌 雙因子驗證設定\n\n✏️ 異動重點｜期限延後至 11\/30\n\n🔗 完整公告：\nhttps:\/\/easyshih-ux\.github\.io\/ysjh-info\/\?announcement=a1$/);
  const supplement = createFollowUpNoticeText(a, "supplement", "操作說明已更新", site, "2026-10-23");
  assert.match(supplement, /^📌【公告補充】[\s\S]*💬 補充｜操作說明已更新/);
  assert.doesNotMatch(supplement, /⏰/);
  const reminder = createFollowUpNoticeText(a, "reminder", "尚未完成的同仁請儘速設定", site, "2026-10-23");
  assert.match(reminder, /^⚠️【提醒】[\s\S]*🔔 尚未完成的同仁請儘速設定\n\n⏰ 截止｜11\/30 12:00 完成設定/);
  assert.doesNotMatch(reminder, /已過期/);
  const chase = createChaseNoticeText({ ...a, collectionMessage: "請於今日完成" }, site, "2026-10-23");
  assert.match(chase, /^🚨【催繳】[\s\S]*🔔 請於今日完成[\s\S]*⏰ 截止｜11\/30 12:00 完成設定/);
  for (const text of [update, supplement, reminder, chase]) assert.ok(!text.includes(a.content));
});

test("首次發布沿用 LINE V2 並依最新內容產生；其他類型使用建立時的快照", () => {
  const a = item({ lineNotificationLevel: "required" });
  assert.match(lineNoticeText(notice(), a, site, "2026-10-23"), /^🔴【重要必讀】/);
  assert.match(lineNoticeText(notice(), { ...a, title: "修正後標題" }, site, "2026-10-23"), /📌 修正後標題/);
  assert.equal(lineNoticeText(notice({ id: "update-2", type: "update", text: "快照文字" }), { ...a, title: "後來又改" }, site, "2026-10-23"), "快照文字");
});

test("待通知清單：只列待發送；下架、撤回、催繳結束或找不到公告時隱藏，復原後再出現", () => {
  const a = item();
  const followUps: Record<string, FollowUp[]> = { a1: [{ id: "fu1", type: "reminder", message: "m", createdAt: "x", status: "withdrawn" }, { id: "fu2", type: "supplement", message: "m", createdAt: "x", status: "active" }] };
  const notices = [
    notice({ createdAt: "2026-10-23T03:00:00.000Z" }),
    notice({ id: "sent", status: "sent" }),
    notice({ id: "followup-fu1", type: "reminder", sourceId: "fu1", text: "t" }),
    notice({ id: "followup-fu2", type: "supplement", sourceId: "fu2", text: "t", createdAt: "2026-10-23T02:00:00.000Z" }),
    notice({ id: "chase-1", type: "chase", sourceId: 1 }),
    notice({ id: "publish", announcementId: "gone" }),
  ];
  assert.deepEqual(pendingLineNotices(notices, [a], followUps).map(item => item.id), ["followup-fu2", "publish"]);
  assert.deepEqual(pendingLineNotices(notices, [{ ...a, collectionStatus: "chasing" }], followUps).map(item => item.id), ["chase-1", "followup-fu2", "publish"]);
  assert.deepEqual(pendingLineNotices(notices, [{ ...a, publicationStatus: "withdrawn" }], followUps), []);
});

test("Firestore 讀取：時間戳轉為 ISO／毫秒，格式不符略過", () => {
  const ts = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms });
  const parsed = lineNoticeFromFirestore("chase-5", "a1", { type: "chase", sourceId: ts(5), publisherUid: "u1", status: "pending", createdBy: "u1", createdAt: ts(0) });
  assert.equal(parsed?.sourceId, 5);
  assert.equal(parsed?.createdAt, "1970-01-01T00:00:00.000Z");
  assert.equal(lineNoticeFromFirestore("x", "a1", { type: "unknown", publisherUid: "u1", status: "pending", createdBy: "u1", createdAt: ts(0) }), null);
  assert.equal(lineNoticeFromFirestore("x", "a1", { type: "publish", publisherUid: "u1", status: "done", createdBy: "u1", createdAt: ts(0) }), null);
});

test("寫入接線：首次發布與公告同批；異動僅在實質修改且勾選時同批；補充提醒同批；相關補充不產生", () => {
  assert.match(source("lib/announcementPublishing.ts"), /batch\.set\(announcementReference, document\);\n\s*if \(publisher\) addPublishLineNotice/);
  const management = source("lib/announcementManagementFirestore.ts");
  assert.match(management, /if \(contentUpdatedAt && lineNotice && original\.publisherUid\)/);
  assert.match(management, /addUpdateLineNotice\(batch, database, edited\.id, original\.publisherUid, lineNotice\.createdBy, nextContentUpdateCount, lineNotice\.text\)/);
  const followUps = source("lib/announcementFollowUps.ts");
  assert.match(followUps, /if \(lineNotice && \(type === "supplement" \|\| type === "reminder"\)\)/);
  const manage = source("app/manage/page.tsx");
  assert.match(manage, /withLine = followLineNotice && \(followType === "supplement" \|\| followType === "reminder"\)/);
  assert.match(manage, /hasAnnouncementContentChanges\(original, editing\)/);
  assert.match(manage, /retryChaseNotice/);
});

test("管理首頁待通知：複製不等於已發送，「我已發送 LINE」只需一次確認", () => {
  const panel = source("components/line-notice-panel.tsx");
  assert.match(source("app/admin/page.tsx"), /<LineNoticePanel publisher=\{publisher\} \/>/);
  assert.match(panel, /我已發送 LINE/);
  assert.match(panel, /confirmLineNoticeSent\(row\.notice, publisher\.uid\)/);
  assert.doesNotMatch(panel, /window\.confirm/);
  const copyHandler = panel.slice(panel.indexOf("const copy"), panel.indexOf("const confirmSent"));
  assert.doesNotMatch(copyHandler, /confirmLineNoticeSent/);
  assert.match(source("lib/lineNoticesFirestore.ts"), /where\("publisherUid", "==", publisher\.uid\), where\("status", "==", "pending"\)/);
});

test("催繳對話框：文字與「需要 LINE 通知」勾選框（預設勾選）在同一畫面，不使用瀏覽器輸入框或確認視窗", () => {
  const manage = source("app/manage/page.tsx");
  assert.match(manage, /<DialogTitle>啟動催繳<\/DialogTitle>/);
  assert.match(manage, /這次催繳需要 LINE 通知/);
  assert.match(manage, /setChaseLineNotice\(LINE_NOTICE_DEFAULT_CHECKED\.chase\)/);
  assert.match(manage, /onClick=\{\(\) => openChase\(item\)\}/);
  assert.doesNotMatch(manage, /window\.prompt/);
  assert.doesNotMatch(manage, /加入「LINE 待通知」嗎/);
  assert.match(manage, /if \(notifyChaseLine\) await retryChaseNotice\(item\.id\)/);
});
