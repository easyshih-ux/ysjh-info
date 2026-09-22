import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { followUpFromFirestore, mergeAnnouncementFollowUps } from "../lib/announcementFollowUps.ts";
import type { FollowUp } from "../lib/announcements.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

test("新 subcollection follow-up 將 Timestamp 正規化為共同 view model", () => {
  assert.deepEqual(followUpFromFirestore("new-1", {
    type: "supplement",
    message: " 補充內容 ",
    authorUid: "publisher-a",
    department: "設備組",
    authorDisplayName: "王組長",
    createdAt: timestamp("2026-09-22T02:30:00.000Z"),
  }), {
    id: "new-1",
    type: "supplement",
    message: "補充內容",
    authorUid: "publisher-a",
    department: "設備組",
    authorDisplayName: "王組長",
    createdAt: "2026-09-22T02:30:00.000Z",
  });
});

test("legacy 與新 follow-up 合併後依 createdAt 新到舊排序", () => {
  const legacy: FollowUp[] = [{ type: "supplement", message: "舊紀錄", createdAt: "2026-09-22T01:00:00.000Z" }];
  const current: FollowUp[] = [{ id: "new", type: "reminder", message: "新紀錄", authorUid: "a", department: "設備組", createdAt: "2026-09-22T03:00:00.000Z" }];
  assert.deepEqual(mergeAnnouncementFollowUps(legacy, current).map(item => item.message), ["新紀錄", "舊紀錄"]);
  assert.equal(mergeAnnouncementFollowUps([], []).length, 0);
});

test("建立 follow-up 使用 serverTimestamp 且不更新 announcement 時間欄位", () => {
  const repository = source("lib/announcementFollowUps.ts");
  assert.match(repository, /createdAt: serverTimestamp\(\)/);
  assert.doesNotMatch(repository, /new Date\(\)\.toISOString|contentUpdatedAt|publishedAt|updatedAt/);
  assert.doesNotMatch(source("lib/announcementManagementFirestore.ts"), /followUps:\s*arrayUnion/);
});

test("首頁維持單次 announcements query，只有開啟詳細內容才 lazy load followUps", () => {
  const home = source("app/page.tsx");
  const announcementReader = source("lib/announcementFirestore.ts");
  assert.match(home, /if \(!selected\) return/);
  assert.match(home, /readAnnouncementFollowUps\(announcementId\)/);
  assert.doesNotMatch(announcementReader, /FOLLOW_UPS_SUBCOLLECTION|readAnnouncementFollowUps/);
});

test("管理詳細頁 lazy load，新增流程提供登入 publisher snapshot", () => {
  const manage = source("app/manage/page.tsx");
  assert.match(manage, /readAnnouncementFollowUps\(item\.id\)/);
  assert.match(manage, /appendManagedFollowUp\(followTarget\.id, followType, message, publisher\)/);
  assert.doesNotMatch(manage, /新增相關補充|type:\s*"related"/);
});
