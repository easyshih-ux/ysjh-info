import assert from "node:assert/strict";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { announcementFromFirestore } from "../lib/announcementFirestore.ts";
import type { Announcement, Attachment } from "../lib/announcements.ts";
import { allowedImageIdentities, hasInvalidImageAudienceSelection, imageAudiencesForSave, shouldShowImageAudiencePicker, imageAudienceSelectionsFrom, imageAudienceStatus, parseStoredImageAudiences, validateImageAudienceSelections, visibleImagesFor } from "../lib/imageAudiences.ts";

const image = (id: string): Attachment => ({ id, type: "image", url: `https://example.test/${id}.webp`, name: `${id}.webp` });
const pdf: Attachment = { id: "pdf-1", type: "pdf", url: "https://example.test/p.pdf", name: "p.pdf", sizeBytes: 100, storagePath: "announcements/a/pdf/u/pdf-1.pdf", contentType: "application/pdf" };
const item = (overrides: Partial<Announcement> = {}): Announcement => ({ ...mockAnnouncements[0], id: "a", audiences: ["全校教師"], attachments: [image("i1"), image("i2"), image("i3"), pdf], ...overrides });
const ids = (rows: ReturnType<typeof visibleImagesFor>) => rows.map(row => row.image.id);

test("可指定身分只來自公告接收對象；全校教師對應全部五種身分", () => {
  assert.deepEqual(allowedImageIdentities(["全校教師"]), ["七年級導師", "八年級導師", "九年級導師", "專任教師", "行政"]);
  assert.deepEqual(allowedImageIdentities(["九年級導師", "七年級導師"]), ["七年級導師", "九年級導師"]);
});

test("沒有標記為共用；合法標記依身分；異常標記不會變成共用", () => {
  const a = item({ imageAudiences: { i1: ["七年級導師"], i2: [], i3: ["校長"] } });
  assert.deepEqual(imageAudienceStatus(a, "i1"), { kind: "targeted", identities: ["七年級導師"] });
  assert.deepEqual(imageAudienceStatus(a, "i2"), { kind: "invalid" }, "空清單");
  assert.deepEqual(imageAudienceStatus(a, "i3"), { kind: "invalid" }, "不明身分");
  assert.deepEqual(imageAudienceStatus(item(), "i1"), { kind: "shared" });
  assert.deepEqual(imageAudienceStatus(item({ imageAudiences: { i1: null } }), "i1"), { kind: "invalid" }, "格式異常");
  assert.deepEqual(imageAudienceStatus(item({ imageAudiences: { i1: ["七年級導師", "七年級導師"] } }), "i1"), { kind: "invalid" }, "重複");
  assert.deepEqual(imageAudienceStatus(item({ imageAudiences: { i1: ["七年級導師", "校長"] } }), "i1"), { kind: "invalid" }, "部分不合法即整筆異常");
  assert.deepEqual(imageAudienceStatus(item({ audiences: ["八年級導師"], imageAudiences: { i1: ["七年級導師"] } }), "i1"), { kind: "invalid" }, "不在接收對象內");
});

test("一般模式：共用＋符合身分的圖片，異常一律隱藏，PDF 不受影響", () => {
  const a = item({ imageAudiences: { i1: ["七年級導師"], i2: ["八年級導師", "九年級導師"], i3: [] } });
  assert.deepEqual(ids(visibleImagesFor(a, "七年級導師", "related")), ["i1"]);
  assert.deepEqual(ids(visibleImagesFor(a, "九年級導師", "related")), ["i2"]);
  assert.deepEqual(ids(visibleImagesFor(a, "行政", "related")), []);
  assert.deepEqual(ids(visibleImagesFor(item(), "行政", "related")), ["i1", "i2", "i3"], "舊公告全部共用");
  assert.ok(visibleImagesFor(a, "七年級導師", "related").every(row => row.image.type === "image"));
});

test("查看全部與身分「全部」顯示所有圖片並附狀態，可辨識異常", () => {
  const a = item({ imageAudiences: { i1: ["七年級導師"], i3: null } });
  for (const rows of [visibleImagesFor(a, "八年級導師", "all"), visibleImagesFor(a, "全部", "related")]) {
    assert.deepEqual(ids(rows), ["i1", "i2", "i3"]);
    assert.deepEqual(rows.map(row => row.status.kind), ["targeted", "shared", "invalid"]);
  }
});

test("不存在的圖片 ID 與 PDF 的 ID 被忽略，不影響其他圖片", () => {
  const a = item({ imageAudiences: { ghost: ["七年級導師"], "pdf-1": ["七年級導師"], i1: ["八年級導師"] } });
  assert.deepEqual(ids(visibleImagesFor(a, "七年級導師", "related")), ["i2", "i3"]);
  assert.deepEqual(ids(visibleImagesFor(a, "八年級導師", "related")), ["i1", "i2", "i3"]);
});

test("Firestore 讀取：字串清單保留原值，其他格式記為異常，非對照表忽略", () => {
  assert.deepEqual(parseStoredImageAudiences({ i1: ["七年級導師"], i2: "七年級導師", i3: [1], i4: [] }), { i1: ["七年級導師"], i2: null, i3: null, i4: [] });
  assert.equal(parseStoredImageAudiences(["七年級導師"]), undefined);
  assert.equal(parseStoredImageAudiences({}), undefined);
  const record = { academicYear: 115, publishedAt: "2026-10-23T01:00:00.000Z", department: "設備組", title: "t", audiences: ["全校教師"], content: "c", attachments: [{ id: "i1", type: "image", url: "https://example.test/i1.webp", name: "i1" }] };
  assert.ok(!("imageAudiences" in announcementFromFirestore("legacy", record)!));
  assert.deepEqual(announcementFromFirestore("tagged", { ...record, imageAudiences: { i1: "bad" } })!.imageAudiences, { i1: null });
});

test("編輯狀態：合法標記帶入勾選，異常標記保留為待修正", () => {
  const a = item({ imageAudiences: { i1: ["七年級導師"], i2: null } });
  assert.deepEqual(imageAudienceSelectionsFrom(a), { i1: ["七年級導師"], i2: "invalid" });
});

test("儲存驗證：標記不在接收對象內或仍為異常時阻擋並提示圖片順序", () => {
  const imageIds = ["i1", "i2", "i3"];
  assert.equal(validateImageAudienceSelections(imageIds, { i1: ["七年級導師"] }, ["七年級導師", "八年級導師"]), undefined);
  assert.match(validateImageAudienceSelections(imageIds, { i2: ["九年級導師"] }, ["七年級導師", "八年級導師"]) ?? "", /第 2 張圖片/);
  assert.match(validateImageAudienceSelections(imageIds, { i1: "invalid", i3: ["行政"] }, ["七年級導師"]) ?? "", /第 1、3 張圖片/);
  assert.equal(validateImageAudienceSelections(imageIds, { i1: [] }, ["七年級導師"]), undefined, "空清單＝共用");
});

test("寫入值：移除共用與不存在圖片；勾選全部可選身分仍保留，不會自動變成共用", () => {
  assert.deepEqual(imageAudiencesForSave(["i1", "i2", "i3"], { i1: ["八年級導師", "七年級導師"], i2: ["八年級導師"], i3: [], ghost: ["七年級導師"] }), { i1: ["七年級導師", "八年級導師"], i2: ["八年級導師"] });
  assert.equal(imageAudiencesForSave(["i1"], { i1: [] }), undefined);
  assert.deepEqual(imageAudiencesForSave(["i1"], { i1: ["行政", "七年級導師"] }), { i1: ["七年級導師", "行政"] }, "依固定身分順序");
  assert.equal(imageAudiencesForSave(["i1"], { i1: "invalid" }), undefined, "異常須先通過驗證修正，不會直接寫入");
});

test("接收對象變更：指定身分的圖片不會意外變成共用", () => {
  const imageIds = ["i1"];
  // 七、八年級 → 只剩七年級：仍保留七年級標記，不轉成共用
  assert.equal(validateImageAudienceSelections(imageIds, { i1: ["七年級導師"] }, ["七年級導師"]), undefined);
  assert.deepEqual(imageAudiencesForSave(imageIds, { i1: ["七年級導師"] }), { i1: ["七年級導師"] });
  // 之後再擴大為七、八年級：八年級導師仍看不到這張七年級圖片
  const expanded = item({ audiences: ["七年級導師", "八年級導師"], attachments: [image("i1")], imageAudiences: { i1: ["七年級導師"] } });
  assert.deepEqual(ids(visibleImagesFor(expanded, "八年級導師", "related")), []);
  // 七、八年級 → 只剩八年級：七年級標記不合法，阻擋儲存（不自動轉共用）
  assert.match(validateImageAudienceSelections(imageIds, { i1: ["七年級導師"] }, ["八年級導師"]) ?? "", /第 1 張圖片/);
  // 若資料已被寫成不合法（例如其他途徑），一般模式隱藏而不是共用
  const stale = item({ audiences: ["八年級導師"], attachments: [image("i1")], imageAudiences: { i1: ["七年級導師"] } });
  assert.deepEqual(ids(visibleImagesFor(stale, "八年級導師", "related")), []);
});

test("勾選區顯示條件與異常判斷", () => {
  assert.equal(shouldShowImageAudiencePicker(["七年級導師"], undefined), false);
  assert.equal(shouldShowImageAudiencePicker(["七年級導師"], ["七年級導師"]), true, "已有標記時不可隱藏");
  assert.equal(shouldShowImageAudiencePicker(["七年級導師"], "invalid"), true);
  assert.equal(shouldShowImageAudiencePicker(["七年級導師", "八年級導師"], undefined), true);
  assert.equal(hasInvalidImageAudienceSelection(["八年級導師"], ["七年級導師"]), true);
  assert.equal(hasInvalidImageAudienceSelection(["八年級導師"], "invalid"), true);
  assert.equal(hasInvalidImageAudienceSelection(["八年級導師"], ["八年級導師"]), false);
});

import { readFileSync } from "node:fs";
import { applyManagedAnnouncementSave, hasAnnouncementContentChanges, hasImageAudienceChanges } from "../lib/announcementManagement.ts";
import { publishDraftToAnnouncement, validateBasicDraft, type BasicAnnouncementDraft } from "../lib/publishDraft.ts";
import { sameImageAudiences } from "../lib/imageAudiences.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const draft = (overrides: Partial<BasicAnnouncementDraft> = {}): BasicAnnouncementDraft => ({
  department: "教務處", title: "t", audiences: ["七年級導師", "八年級導師"], content: "c", importantEvents: [], deadlines: [], links: [],
  attachments: [{ id: "i1", type: "image", name: "a", caption: "", previewUrl: "blob:1" }, { id: "i2", type: "image", name: "b", caption: "", previewUrl: "blob:2" }],
  ...overrides,
});

test("發布：寫入合法標記，未勾選不寫入；標記不在接收對象內時阻擋發布", () => {
  const tagged = publishDraftToAnnouncement(draft({ imageAudienceSelections: { i1: ["七年級導師"], i2: [] } }), "id", "2026-10-23T01:00:00.000Z", 115);
  assert.deepEqual(tagged.imageAudiences, { i1: ["七年級導師"] });
  assert.ok(!("imageAudiences" in publishDraftToAnnouncement(draft(), "id", "2026-10-23T01:00:00.000Z", 115)));
  assert.equal(validateBasicDraft(draft({ imageAudienceSelections: { i1: ["七年級導師"] } })).imageAudienceSelections, undefined);
  assert.match(validateBasicDraft(draft({ audiences: ["八年級導師"], imageAudienceSelections: { i1: ["七年級導師"] } })).imageAudienceSelections ?? "", /第 1 張圖片/);
});

test("編輯：只改圖片身分不算公告內容修正，可清除與比較順序無關", () => {
  const original = item({ attachments: [image("i1")], imageAudiences: { i1: ["七年級導師", "八年級導師"] } });
  const reordered = { ...original, imageAudiences: { i1: ["八年級導師", "七年級導師"] } };
  assert.equal(sameImageAudiences(original.imageAudiences, reordered.imageAudiences), true);
  assert.equal(hasImageAudienceChanges(original, reordered), false);
  const retagged = { ...original, imageAudiences: { i1: ["專任教師"] } };
  assert.equal(hasImageAudienceChanges(original, retagged), true);
  assert.equal(hasAnnouncementContentChanges(original, retagged), false, "不增加公告修正次數");
  const saved = applyManagedAnnouncementSave(original, retagged, null);
  assert.deepEqual(saved.imageAudiences, { i1: ["專任教師"] });
  assert.equal(saved.contentUpdatedAt, original.contentUpdatedAt);
  const { imageAudiences: _removed, ...cleared } = original;
  assert.ok(!("imageAudiences" in applyManagedAnnouncementSave(original, cleared as Announcement, null)));
});

test("介面接線：首頁視窗依身分篩選圖片，直達連結判斷不變，管理端可修改並清除標記", () => {
  const page = source("app/page.tsx");
  assert.match(page, /visibleImagesFor\(selected, identity, viewMode\)/);
  assert.match(page, /attachment\.type === "pdf" \|\| dialogImageStatuses\.has\(attachment\.id\)/);
  assert.match(page, /resolveAnnouncementDeepLink\(announcements, announcementId, identity, viewMode\)/);
  assert.match(source("lib/announcementManagementFirestore.ts"), /imageAudiences: edited\.imageAudiences \?\? deleteField\(\)/);
  const manage = source("app/manage/page.tsx");
  assert.match(manage, /validateImageAudienceSelections\(imageIds, imageSelections, editing\.audiences\)/);
  assert.match(manage, /setImageSelections\(imageAudienceSelectionsFrom\(item\)\)/);
  assert.match(source("app/publish/page.tsx"), /<ImageAudiencePicker imageId=\{attachment\.id\} allowed=\{allowedImageIdentities\(draft\.audiences\)\}/);
  assert.doesNotMatch(source("lib/lineAnnouncementSummary.ts"), /imageAudiences/);
  assert.doesNotMatch(source("lib/announcementDeepLink.ts"), /imageAudiences/);
});
