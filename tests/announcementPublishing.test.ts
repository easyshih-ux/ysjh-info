import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { announcementImagePath, createFirestoreAnnouncement } from "../lib/announcementPublishing.ts";
import { fitImageWithinMaxEdge, MAX_COMPRESSED_IMAGE_BYTES, MAX_IMAGE_EDGE } from "../lib/imageCompression.ts";
import type { BasicAnnouncementDraft } from "../lib/publishDraft.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const draft = (overrides: Partial<BasicAnnouncementDraft> = {}): BasicAnnouncementDraft => ({ department: "設備組", title: "Firestore 發布測試", audiences: ["全校教師"], content: "測試內容", attachments: [], importantEvents: [], deadlines: [], links: [], ...overrides });

test("Firestore 文件使用既有 schema 且初次發布時間一致", () => {
  const publishedAt = "2026-09-19T10:00:00.000Z";
  const document = createFirestoreAnnouncement(draft(), 115, publishedAt);
  assert.equal(document.publishedAt, publishedAt);
  assert.equal(document.updatedAt, publishedAt);
  assert.equal(document.academicYear, 115);
  assert.deepEqual(document.attachments, []);
  assert.deepEqual(document.deadlines, []);
  for (const field of ["id", "deadline", "submissionLink", "relatedLink"]) assert.equal(field in document, false);
});

test("Storage path 與預先產生的 Firestore document ID 一致", () => {
  assert.equal(announcementImagePath("announcement-123", "image-456"), "announcements/announcement-123/image-456.webp");
});

test("發布先取得 Firestore ID、上傳圖片後才 setDoc", () => {
  const publishing = source("lib/announcementPublishing.ts");
  assert.match(publishing, /doc\(collection\(database, ANNOUNCEMENTS_COLLECTION\)\)/);
  assert.match(publishing, /announcementReference\.id/);
  assert.match(publishing, /await uploadBytes/);
  assert.match(publishing, /await getDownloadURL/);
  assert.match(publishing, /await setDoc\(announcementReference, document\)/);
  assert.ok(publishing.indexOf("await uploadAnnouncementImage") < publishing.indexOf("await setDoc"));
  assert.doesNotMatch(publishing, /initializeApp\(/);
});

test("圖片輸出 WebP、最長邊不超過 1920 且限制 2 MB", () => {
  assert.equal(MAX_IMAGE_EDGE, 1920);
  assert.equal(MAX_COMPRESSED_IMAGE_BYTES, 2 * 1024 * 1024);
  assert.deepEqual(fitImageWithinMaxEdge(4032, 3024), { width: 1920, height: 1440 });
  assert.deepEqual(fitImageWithinMaxEdge(800, 600), { width: 800, height: 600 });
  const compression = source("lib/imageCompression.ts");
  assert.match(compression, /"image\/webp"/);
  assert.match(compression, /IMAGE_COMPRESSION_ERROR_MESSAGE/);
  assert.match(compression, /imageOrientation: "from-image"/);
});

test("Firestore attachments 使用正式 URL 且不含 blob、File 或 previewUrl", () => {
  const document = createFirestoreAnnouncement(draft(), 115, "2026-09-19T10:00:00.000Z", [{ id: "image-1", type: "image", url: "https://firebasestorage.googleapis.com/example.webp", name: "原圖.jpg", caption: "說明" }]);
  assert.equal(document.attachments[0].url.startsWith("https://"), true);
  assert.equal(document.attachments[0].url.startsWith("blob:"), false);
  assert.equal("previewUrl" in document.attachments[0], false);
  assert.equal("file" in document.attachments[0], false);
});

test("Storage 上傳失敗時不會執行後面的 Firestore setDoc", () => {
  const publishing = source("lib/announcementPublishing.ts");
  assert.ok(publishing.indexOf("await Promise.all(compressed.map") < publishing.indexOf("await setDoc"));
  assert.match(publishing, /catch \(error\)[\s\S]*throw new AnnouncementPublishError/);
});

test("預覽 Modal 有固定操作、防重複送出與分階段狀態", () => {
  const page = source("app/publish/page.tsx");
  const styles = source("app/publish/publish.module.css");
  const confirmPublish = page.slice(page.indexOf("const confirmPublish"), page.indexOf("if (publishedAnnouncement)"));
  assert.match(page, />返回修改</);
  assert.match(page, /"確認發布"/);
  assert.match(page, /disabled=\{publishing\}/);
  assert.match(confirmPublish, /publishingRef\.current/);
  assert.match(confirmPublish, /catch \(error\)[\s\S]*setPublishError/);
  assert.doesNotMatch(confirmPublish, /setDraft\(/);
  assert.match(page, /處理圖片中…/);
  assert.match(page, /上傳圖片中…/);
  assert.match(styles, /\.previewDialog\{[^}]*overflow:hidden/);
  assert.match(styles, /\.previewScroll\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.previewFooter\{/);
});

test("圖片新增 UI、五張上限與本機預覽仍存在", () => {
  const page = source("app/publish/page.tsx");
  assert.match(page, /公告圖片／附件/);
  assert.match(page, /accept="image\/\*" multiple/);
  assert.match(page, /＋新增圖片/);
  assert.match(page, /draft\.attachments\.length < MAX_PUBLISH_IMAGES/);
  assert.match(page, /每則公告最多 5 張圖片/);
  assert.match(page, /preview\.attachments\.map/);
  assert.match(page, /URL\.createObjectURL/);
  assert.match(page, /URL\.revokeObjectURL/);
});
