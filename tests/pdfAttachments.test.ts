import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatFileSize, MAX_PDF_BYTES, sanitizeAttachmentName, selectPublishPdfs } from "../lib/attachmentFiles.ts";
import { announcementFromFirestore } from "../lib/announcementFirestore.ts";
import { announcementPdfPath } from "../lib/announcementPublishing.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const record = (attachments?: unknown[]) => ({ academicYear: 115, publishedAt: "2026-09-19T08:00:00.000Z", department: "設備組", title: "PDF 公告", audiences: ["全校教師"], content: "內容", importantEvents: [], deadlines: [], ...(attachments ? { attachments } : {}), links: [], followUps: [] });
const pdf = { id: "pdf-1", type: "pdf", url: "https://example.test/plan.pdf", name: "活動實施計畫.pdf", sizeBytes: 2457600, storagePath: "announcements/a1/pdf/userA/pdf-1.pdf", contentType: "application/pdf" };

test("PDF 選取限制格式、5 MB 與最多兩份", () => {
  const files = [
    { name: "one.pdf", type: "application/pdf", size: MAX_PDF_BYTES },
    { name: "two.pdf", type: "application/pdf", size: 1024 },
    { name: "three.pdf", type: "application/pdf", size: 1024 },
    { name: "large.pdf", type: "application/pdf", size: MAX_PDF_BYTES + 1 },
    { name: "word.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1024 },
  ];
  const result = selectPublishPdfs(files, 0);
  assert.deepEqual(result.accepted.map(item => item.name), ["one.pdf", "two.pdf"]);
  assert.equal(result.overLimitCount, 1);
  assert.equal(result.oversizedCount, 1);
  assert.equal(result.invalidTypeCount, 1);
});

test("PDF 名稱清理、大小顯示與 Storage path 不使用原始檔名", () => {
  assert.equal(sanitizeAttachmentName("  活動\u0000計畫.pdf  "), "活動計畫.pdf");
  assert.equal(formatFileSize(2457600), "2.3 MB");
  assert.equal(announcementPdfPath("a1", "userA", "random-id"), "announcements/a1/pdf/userA/random-id.pdf");
  assert.doesNotMatch(announcementPdfPath("a1", "userA", "random-id"), /活動實施計畫/);
});

test("Firestore parser 相容無附件、舊圖片與合法 PDF metadata", () => {
  assert.deepEqual(announcementFromFirestore("empty", record())?.attachments, []);
  assert.equal(announcementFromFirestore("image", record([{ id: "image-1", type: "image", url: "https://example.test/image.webp", name: "舊圖片" }]))?.attachments[0].type, "image");
  const parsed = announcementFromFirestore("pdf", record([pdf]))?.attachments[0];
  assert.equal(parsed?.type, "pdf");
  if (parsed?.type === "pdf") assert.equal(parsed.storagePath, pdf.storagePath);
});

test("發布上傳使用 PDF 專用路徑、MIME 與 uploaderUid metadata", () => {
  const publishing = source("lib/announcementPublishing.ts");
  assert.match(publishing, /announcementPdfPath\(announcementId, uploaderUid, attachment\.id\)/);
  assert.match(publishing, /contentType: "application\/pdf"/);
  assert.match(publishing, /customMetadata: \{ uploaderUid \}/);
  assert.match(publishing, /await cleanupFailedAnnouncementUpload\(announcementReference\.id\)/);
});

test("公開頁與管理頁提供安全的新分頁 PDF 連結", () => {
  for (const path of ["app/page.tsx", "app/manage/page.tsx"]) {
    const content = source(path);
    assert.match(content, /target="_blank"/);
    assert.match(content, /rel="noopener noreferrer"/);
    assert.match(content, /PDF・\{formatFileSize/);
  }
});

test("發布頁立即驗證並顯示 PDF draft 卡片", () => {
  const page = source("app/publish/page.tsx");
  assert.match(page, /accept="application\/pdf,\.pdf"/);
  assert.match(page, /每則公告最多 2 份 PDF/);
  assert.match(page, /PDF 單檔不可超過 5 MB/);
  assert.match(page, /removePdf/);
});
