import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasPublishAttachments, validateAttachmentPrivacyConfirmation } from "../lib/attachmentPrivacyConfirmation.ts";
import { createFirestoreAnnouncement } from "../lib/announcementPublishing.ts";
import { validateBasicDraft, type BasicAnnouncementDraft, type PublishImageAttachment, type PublishPdfAttachment } from "../lib/publishDraft.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const image = { id: "image-1", type: "image", name: "photo.jpg", caption: "", previewUrl: "blob:photo" } satisfies PublishImageAttachment;
const pdf = { id: "pdf-1", type: "pdf", name: "notice.pdf", sizeBytes: 1024, file: { name: "notice.pdf", type: "application/pdf", size: 1024 } as File } satisfies PublishPdfAttachment;
const draft = (overrides: Partial<BasicAnnouncementDraft> = {}): BasicAnnouncementDraft => ({ department: "設備組", title: "附件公告", audiences: ["全校教師"], content: "內容", attachments: [], pdfAttachments: [], importantEvents: [], deadlines: [], links: [], ...overrides });

test("無附件不要求公開內容確認", () => {
  assert.equal(hasPublishAttachments(draft()), false);
  assert.equal(validateAttachmentPrivacyConfirmation(draft(), false), undefined);
});

test("圖片、PDF 或兩者同時存在時皆使用同一個確認", () => {
  for (const value of [draft({ attachments: [image] }), draft({ pdfAttachments: [pdf] }), draft({ attachments: [image], pdfAttachments: [pdf] })]) {
    assert.equal(hasPublishAttachments(value), true);
    assert.equal(validateAttachmentPrivacyConfirmation(value, false), "請先確認附件公開內容後再發布。");
    assert.equal(validateAttachmentPrivacyConfirmation(value, true), undefined);
    assert.deepEqual(validateBasicDraft(value), {});
  }
});

test("附件全部移除後不再阻擋發布", () => {
  const removed = draft({ attachments: [], pdfAttachments: [] });
  assert.equal(validateAttachmentPrivacyConfirmation(removed, false), undefined);
});

test("發布頁會在附件變動時重設確認並於正式發布前驗證", () => {
  const page = source("app/publish/page.tsx");
  assert.match(page, /⚠️ 附件公開提醒/);
  assert.match(page, /我已確認附件內容，未包含不應公開的他人個人資料。/);
  assert.match(page, /setAttachmentPrivacyConfirmed\(false\)/);
  const confirmPublish = page.slice(page.indexOf("const confirmPublish"), page.indexOf("if (publishedAnnouncement)"));
  assert.match(confirmPublish, /validateAttachmentPrivacyConfirmation\(validatedDraft, attachmentPrivacyConfirmed\)/);
  assert.ok(confirmPublish.indexOf("validateAttachmentPrivacyConfirmation") < confirmPublish.indexOf("publishAnnouncement"));
});

test("附件確認狀態不屬於 draft、Announcement 或 Firestore 文件", () => {
  const document = createFirestoreAnnouncement(draft(), 115, "2026-09-22T00:00:00.000Z");
  assert.equal("attachmentPrivacyConfirmed" in document, false);
  assert.doesNotMatch(source("lib/announcements.ts"), /attachmentPrivacyConfirmed/);
  assert.doesNotMatch(source("lib/announcementPublishing.ts"), /attachmentPrivacyConfirmed/);
});
