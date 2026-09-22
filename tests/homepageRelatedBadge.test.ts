import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("首頁只在 summary 嚴格為 true 時顯示其他單位補充 badge", () => {
  const page = source("app/page.tsx");
  assert.match(page, /a\.hasRelatedFollowUp === true/);
  assert.match(page, /💬 有其他單位補充/);
  assert.match(page, /className="related-followup-badge"/);
  assert.match(page, /latestFollowUp \|\| a\.hasRelatedFollowUp === true/);
});

test("首頁 badge 維持單一 announcements 主查詢，不增加 followUps N+1", () => {
  const page = source("app/page.tsx");
  const firestore = source("lib/announcementFirestore.ts");
  assert.equal((page.match(/readPublicAnnouncements\(/g) ?? []).length, 1);
  assert.doesNotMatch(firestore, /followUpsCollection|readAnnouncementFollowUps/);
  assert.match(page, /if \(!selected\) return/);
  assert.match(page, /const announcementId = selected\.id/);
  assert.match(page, /readAnnouncementFollowUps\(announcementId\)/);
});

test("首頁兩種 badge 可並列換行且 related badge 使用藍色系", () => {
  const styles = source("app/globals.css");
  assert.match(styles, /\.announcement-badges\{[^}]*display:flex[^}]*flex-wrap:wrap[^}]*max-width:100%/);
  assert.match(styles, /\.related-followup-badge\{[^}]*#b9cddd[^}]*#edf5fa[^}]*#315a7c[^}]*overflow-wrap:anywhere/);
});

test("related LINE 單筆 formatter 與兩處複製 UI 已移除，原公告 formatter 保留", () => {
  const helper = source("lib/lineAnnouncementSummary.ts");
  const publicPage = source("app/page.tsx");
  const managePage = source("app/manage/page.tsx");
  assert.doesNotMatch(`${helper}\n${publicPage}\n${managePage}`, /createLineRelatedFollowUpSummary|複製補充通知/);
  assert.match(helper, /createLineAnnouncementSummary/);
  assert.match(source("components/line-summary-card.tsx"), /createLineAnnouncementSummary/);
});
