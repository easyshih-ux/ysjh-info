import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEPARTMENTS } from "../lib/departments.ts";
import { DEPARTMENT_EXTENSIONS, defaultContactForDepartment, formatContactCompact, formatContactSentence, getFixedDepartmentExtension, normalizeAnnouncementContact, selectContactDepartment, validateAnnouncementContact } from "../lib/departmentContacts.ts";
import { publishDraftToAnnouncement, validateBasicDraft, type BasicAnnouncementDraft } from "../lib/publishDraft.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const draft = (overrides: Partial<BasicAnnouncementDraft> = {}): BasicAnnouncementDraft => ({ department: "設備組", title: "聯絡資訊測試", audiences: ["全校教師"], content: "內容", attachments: [], importantEvents: [], deadlines: [], links: [], ...overrides });

test("22 個固定單位都有唯一集中分機設定", () => {
  assert.equal(DEPARTMENTS.length, 22);
  assert.deepEqual(Object.keys(DEPARTMENT_EXTENSIONS).sort(), [...DEPARTMENTS].sort());
  assert.equal(getFixedDepartmentExtension("設備組"), "104");
  assert.equal(getFixedDepartmentExtension("訓育組"), "202");
});

test("固定單位切換會同步系統分機且不可保存任意分機", () => {
  assert.deepEqual(defaultContactForDepartment("設備組"), { department: "設備組", extension: "104" });
  assert.deepEqual(selectContactDepartment({ department: "設備組", extension: "104" }, "訓育組"), { department: "訓育組", extension: "202" });
  assert.equal(validateAnnouncementContact({ department: "設備組", extension: "999" }), "固定聯絡單位的分機必須使用系統設定");
  assert.deepEqual(normalizeAnnouncementContact({ department: "設備組", extension: "999" }), { department: "設備組", extension: "104" });
});

test("自訂聯絡單位會 trim 且要求合法名稱與校內分機", () => {
  assert.deepEqual(normalizeAnnouncementContact({ department: "  教師會  ", extension: " 123 " }), { department: "教師會", extension: "123" });
  assert.equal(validateAnnouncementContact({ department: "", extension: "123" }), "請輸入實際聯絡單位名稱");
  assert.equal(validateAnnouncementContact({ department: "其他", extension: "123" }), "實際聯絡單位名稱不可使用「其他」");
  assert.equal(validateAnnouncementContact({ department: "教師會", extension: "" }), "請輸入校內分機");
  assert.match(validateAnnouncementContact({ department: "教師會", extension: "09-1234" }) ?? "", /位數字/);
  assert.deepEqual(validateBasicDraft(draft({ contact: { department: "教師會", extension: "123" } })), {});
});

test("關閉聯絡資訊後不輸出 contact，啟用時保存 snapshot", () => {
  const withoutContact = publishDraftToAnnouncement(draft(), "a", "2026-09-22T00:00:00Z", 115);
  assert.equal(withoutContact.contact, undefined);
  const withContact = publishDraftToAnnouncement(draft({ contact: { department: "設備組", extension: "104" } }), "b", "2026-09-22T00:00:00Z", 115);
  assert.deepEqual(withContact.contact, { department: "設備組", extension: "104" });
});

test("網站與 LINE 的聯絡文案由集中 formatter 產生", () => {
  const contact = { department: "設備組", extension: "104" };
  assert.equal(formatContactCompact(contact), "☎ 業務聯絡｜設備組｜分機 104");
  assert.equal(formatContactSentence(contact), "☎ 如有任何疑問，請洽設備組，分機 104。");
  assert.match(source("components/announcement-contact.tsx"), /formatContactCompact/);
  assert.match(source("lib/lineAnnouncementSummary.ts"), /formatContactSentence/);
});

test("發布頁固定分機唯讀並支援自訂發布單位預填", () => {
  const page = source("app/publish/page.tsx");
  assert.match(page, /contact: defaultContactForDepartment\(department\)/);
  assert.match(page, /<DepartmentOptionGroups includeOther \/>/);
  assert.match(page, /value=\{getFixedDepartmentExtension\(draft\.contact\.department\)\} readOnly/);
  assert.match(page, /實際聯絡單位名稱/);
});

test("公開頁、發布預覽與管理頁都顯示公告保存的聯絡資訊", () => {
  const publicPage = source("app/page.tsx");
  const publishPage = source("app/publish/page.tsx");
  const managePage = source("app/manage/page.tsx");
  assert.match(publicPage, /<AnnouncementContactLine contact=\{selected\.contact\}/);
  assert.match(publishPage, /<AnnouncementContactLine contact=\{preview\.contact\}/);
  assert.match(managePage, /formatContactCompact\(item\.contact\)/);
});
