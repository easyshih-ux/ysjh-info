import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { announcementFromFirestore, sortAnnouncementsNewestFirst } from "../lib/announcementFirestore.ts";
import { filterAnnouncements, upcomingDeadlines, weeklyEvents } from "../lib/announcementLogic.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const firestoreRecord = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115,
  publishedAt: "2026-09-19T08:00:00.000Z",
  updatedAt: "2026-09-19T08:00:00.000Z",
  department: "設備組",
  title: "Firestore 正式公告",
  audiences: ["全校教師"],
  content: "公告內容",
  importantEvents: [{ date: "2026-09-19", time: "10:00", title: "本週活動" }],
  deadlines: [{ date: "2026-09-20", time: "17:00", label: "繳交截止" }],
  attachments: [{ id: "image-1", type: "image", url: "https://firebasestorage.googleapis.com/example.webp", name: "圖片.webp", caption: "圖片說明" }],
  links: [{ id: "link-1", label: "填寫表單", url: "https://example.com", type: "website", isPrimary: true }],
  followUps: [{ createdAt: "2026-09-19T09:00:00.000Z", type: "reminder", message: "請留意期限" }],
  ...overrides,
});

test("首頁正式資料來源為 Firestore，不匯入 mock fixture 或要求教師登入", () => {
  const page = source("app/page.tsx");
  assert.match(page, /readPublicAnnouncements/);
  assert.doesNotMatch(page, /mockAnnouncements|useFirebaseAuth|AdminAuthGuard/);
  assert.match(source("lib/announcementFirestore.ts"), /collection\(getFirestoreClient\(\), ANNOUNCEMENTS_COLLECTION\)/);
});

test("Firestore document 轉成既有 Announcement 並使用 document ID", () => {
  const item = announcementFromFirestore("firestore-id", firestoreRecord());
  assert.equal(item?.id, "firestore-id");
  assert.equal(item?.department, "設備組");
  assert.equal(item?.attachments[0].caption, "圖片說明");
});

test("publishedAt 依新到舊排序", () => {
  const older = announcementFromFirestore("older", firestoreRecord({ publishedAt: "2026-09-18T08:00:00.000Z" }))!;
  const newer = announcementFromFirestore("newer", firestoreRecord({ publishedAt: "2026-09-19T08:00:00.000Z" }))!;
  assert.deepEqual(sortAnnouncementsNewestFirst([older, newer]).map(item => item.id), ["newer", "older"]);
});

test("Firestore importantEvents 與 deadlines 分別進入既有首頁邏輯", () => {
  const item = announcementFromFirestore("one", firestoreRecord())!;
  const now = new Date("2026-09-19T08:00:00+08:00");
  assert.equal(weeklyEvents([item], now)[0].title, "本週活動");
  assert.equal(upcomingDeadlines([item], now)[0].deadline.label, "繳交截止");
});

test("正式 HTTPS attachment 可處理，非 HTTPS attachment 不進入首頁", () => {
  assert.match(announcementFromFirestore("one", firestoreRecord())!.attachments[0].url, /^https:\/\//);
  assert.deepEqual(announcementFromFirestore("two", firestoreRecord({ attachments: [{ id: "bad", type: "image", url: "blob:test", name: "本機圖片" }] }))!.attachments, []);
});

test("缺少遠端陣列欄位時一律正規化為空陣列", () => {
  const item = announcementFromFirestore("one", firestoreRecord({ audiences: undefined, attachments: undefined, links: undefined, followUps: undefined, importantEvents: undefined, deadlines: undefined }))!;
  assert.deepEqual({ audiences: item.audiences, attachments: item.attachments, links: item.links, followUps: item.followUps, importantEvents: item.importantEvents, deadlines: item.deadlines }, { audiences: [], attachments: [], links: [], followUps: [], importantEvents: [], deadlines: [] });
});

test("不合法核心文件會被略過，不影響其他公告", () => {
  assert.equal(announcementFromFirestore("bad", firestoreRecord({ publishedAt: "not-a-date" })), null);
  assert.equal(announcementFromFirestore("bad", firestoreRecord({ department: "不存在單位" })), null);
  assert.deepEqual(announcementFromFirestore("one", firestoreRecord({ followUps: [{ createdAt: "not-a-date", type: "reminder", message: "無效日期" }] }))!.followUps, []);
});

test("既有關鍵字、department、audiences 搜尋可套用 Firestore 公告", () => {
  const item = announcementFromFirestore("one", firestoreRecord())!;
  assert.equal(filterAnnouncements([item], "正式公告", "全部", "設備組").length, 1);
  assert.equal(filterAnnouncements([item], "", "全校教師", "設備組").length, 1);
  assert.equal(filterAnnouncements([item], "", "七年級導師", "設備組").length, 0);
});

test("首頁具備 loading、讀取失敗、0 筆公告與圖片 fallback", () => {
  const page = source("app/page.tsx");
  assert.match(page, /公告載入中…/);
  assert.match(page, /目前無法載入公告，請稍後再試。/);
  assert.match(page, /目前沒有公告。/);
  assert.match(page, /onError=\{\(\) => setFailed\(true\)\}/);
});
