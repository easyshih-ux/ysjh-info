import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { announcementImagePath, announcementPdfPath, createFirestoreAnnouncement } from "../lib/announcementPublishing.ts";
import { fitImageWithinMaxEdge, MAX_COMPRESSED_IMAGE_BYTES, MAX_IMAGE_EDGE } from "../lib/imageCompression.ts";
import type { BasicAnnouncementDraft } from "../lib/publishDraft.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const draft = (overrides: Partial<BasicAnnouncementDraft> = {}): BasicAnnouncementDraft => ({ department: "設備組", title: "Firestore 發布測試", audiences: ["全校教師"], content: "測試內容", attachments: [], importantEvents: [], deadlines: [], links: [], ...overrides });

test("Firestore 文件使用既有 schema 且初次發布時間一致", () => {
  const publishedAt = "2026-09-19T10:00:00.000Z";
  const document = createFirestoreAnnouncement(draft(), 115, publishedAt);
  assert.equal(document.publishedAt, publishedAt);
  assert.equal(document.updatedAt, publishedAt);
  assert.equal(document.contentUpdatedAt, undefined);
  assert.equal(document.academicYear, 115);
  assert.deepEqual(document.attachments, []);
  assert.deepEqual(document.deadlines, []);
  for (const field of ["id", "deadline", "submissionLink", "relatedLink"]) assert.equal(field in document, false);
});

test("正式發布寫入 Firebase UID 作者與獨立發布狀態", () => {
  const document = createFirestoreAnnouncement(draft(), 115, "2026-09-19T10:00:00.000Z", [], { uid: "publisher-uid", email: "publisher@example.test", displayName: "Publisher" });
  assert.equal(document.publisherUid, "publisher-uid");
  assert.equal(document.publisherEmail, "publisher@example.test");
  assert.equal(document.publicationStatus, "published");
  assert.equal(document.collectionStatus, undefined);
});

test("Storage path 與預先產生的 Firestore document ID 一致", () => {
  assert.equal(announcementImagePath("announcement-123", "image-456"), "announcements/announcement-123/image-456.webp");
  assert.equal(announcementPdfPath("announcement-123", "publisher-uid", "pdf-456"), "announcements/announcement-123/pdf/publisher-uid/pdf-456.pdf");
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
  assert.equal(document.attachments[0]?.url.startsWith("https://"), true);
  assert.equal(document.attachments[0]?.url.startsWith("blob:"), false);
  assert.equal("previewUrl" in document.attachments[0], false);
  assert.equal("file" in document.attachments[0], false);
});

test("Storage 上傳失敗時不會執行後面的 Firestore setDoc", () => {
  const publishing = source("lib/announcementPublishing.ts");
  assert.ok(publishing.indexOf("await uploadAnnouncementImage") < publishing.indexOf("await setDoc"));
  assert.match(publishing, /catch \(error\)[\s\S]*throw new AnnouncementPublishError/);
});

test("發布失敗會由後端清理本次公告已嘗試上傳的圖片且保留原始錯誤", () => {
  const publishing = source("lib/announcementPublishing.ts");
  const page = source("app/publish/page.tsx");
  assert.match(publishing, /uploadedPaths\.push\(announcementImagePath\(announcementReference\.id, attachment\.id\)\)/);
  assert.match(publishing, /customMetadata: \{ uploaderUid \}/);
  assert.match(publishing, /"cleanupFailedAnnouncementUpload"/);
  assert.match(publishing, /getFunctions\(getFirebaseApp\(\), "asia-east1"\)/);
  assert.match(publishing, /console\.error\("announcement publish failed", \{[\s\S]*code:[\s\S]*message:[\s\S]*error,/);
  assert.match(publishing, /catch \(cleanupError\)[\s\S]*console\.error[\s\S]*throw new AnnouncementPublishError/);
  assert.doesNotMatch(page, /error\.code|publisher\.uid.*publishError/);
  assert.match(page, /error instanceof ImageCompressionError \|\| error instanceof AnnouncementPublishError \? error\.message : "公告發布失敗/);
  assert.doesNotMatch(publishing, /deleteObject\(/);
});

test("發布前總檢查顯示具體摘要並依 reduced motion 定位第一個錯誤欄位", () => {
  const page = source("app/publish/page.tsx");
  assert.match(page, /尚有資料需要修正/);
  assert.match(page, /validateForPublish\(\)/);
  assert.match(page, /formRef\.current\?\.querySelector/);
  assert.match(page, /target\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(page, /scrollIntoView\(\{ behavior: reducedMotion \? "auto" : "smooth"/);
  assert.match(page, /const validatedDraft = validateForPublish\(\);[\s\S]*if \(!validatedDraft\) return;[\s\S]*publishAnnouncement\(validatedDraft/);
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

test("預覽與確認發布按鈕具備獨立的 enabled 與 disabled 對比樣式", () => {
  const page = source("app/publish/page.tsx");
  const styles = source("app/publish/publish.module.css");
  const buttonStyles = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some(selector => /^\.(previewButton|publishButton)(?::|$)/.test(selector.trim())))
    .map(match => match[0])
    .join("\n");
  assert.match(page, /className=\{styles\.previewButton\}[^>]*type="submit"/);
  assert.match(page, /className=\{styles\.publishButton\}[^>]*disabled=\{publishing\}/);
  assert.match(styles, /\.previewButton\{[^}]*#dceeff[^}]*#17324d/);
  assert.match(styles, /\.publishButton\{[^}]*#3f6f9f[^}]*#fff/);
  assert.match(styles, /\.previewButton:disabled,\.publishButton:disabled\{[^}]*#e7edf2[^}]*#73808d[^}]*opacity:1/);
  assert.doesNotMatch(buttonStyles, /!important/);
});

test("圖片新增 UI、五張上限與本機預覽仍存在", () => {
  const page = source("app/publish/page.tsx");
  assert.match(page, /<h4>圖片<\/h4>/);
  assert.match(page, /accept="image\/\*" multiple/);
  assert.match(page, /＋新增圖片/);
  assert.match(page, /draft\.attachments\.length < MAX_PUBLISH_IMAGES/);
  assert.match(page, /每則公告最多 5 張圖片/);
  assert.match(page, /preview\.attachments\.map/);
  assert.match(page, /URL\.createObjectURL/);
  assert.match(page, /URL\.revokeObjectURL/);
});
