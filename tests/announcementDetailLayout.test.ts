import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("公告詳細頁先顯示原文，再顯示後續補充", () => {
  const page = source("app/page.tsx");
  const dates = page.indexOf('className="detail-dates"');
  const content = page.indexOf('className="detail-content"');
  const originalFollowUp = page.indexOf('className="followup-panel"');
  const related = page.indexOf('className="followup-panel related-followups"');
  const contact = page.indexOf('className="announcement-contact"');
  const attachments = page.indexOf('className="attachment-section"');
  assert.ok(dates < content && content < originalFollowUp && originalFollowUp < related && related < contact && contact < attachments);
});

test("重要日期與期限標題強化，不改卡片背景", () => {
  const styles = source("app/globals.css");
  assert.match(styles, /\.detail-dates h4\{[^}]*font-size:16px[^}]*font-weight:700[^}]*color:#315a7c/);
  assert.match(styles, /\.deadline-detail h4,\.deadline-detail h4 svg\{color:#a85a12\}/);
  assert.match(styles, /\.deadline-detail p strong\{color:#9a4f0d\}/);
  assert.doesNotMatch(styles, /\.deadline-detail\{[^}]*background:/);
});

test("公告正文與後續正式區塊共用 section heading 層級", () => {
  const styles = source("app/globals.css");
  assert.match(styles, /\.detail-dates h4,\.detail-content h4,\.followup-panel h4,\.attachment-section>h4,\.links-section>h4\{[^}]*font-size:16px[^}]*font-weight:700/);
  assert.match(styles, /\.detail-content h4,\.attachment-section>h4,\.links-section>h4\{color:#315a7c\}/);
  assert.match(styles, /\.announcement-contact\{color:#315a7c;font-size:16px/);
});

test("過往補充展開操作低於正式標題字重", () => {
  const styles = source("app/globals.css");
  assert.match(styles, /\.followup-panel summary\{font-weight:600\}/);
});

test("其他單位補充使用單位 badge、內層小卡與手機防溢出樣式", () => {
  const page = source("app/page.tsx");
  const styles = source("app/globals.css");
  assert.match(page, /💬 其他單位補充/);
  assert.match(page, /className="related-followup-card"/);
  assert.match(page, /<DepartmentBadge department=\{item\.department/);
  assert.match(page, /className="related-copy-button"/);
  assert.match(styles, /\.related-followup-meta\{[^}]*flex-wrap:wrap[^}]*min-width:0/);
  assert.match(styles, /\.related-followup-card p\{[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /@media\(max-width:420px\)[\s\S]*\.related-copy-button\{width:100%/);
});
