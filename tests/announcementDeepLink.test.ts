import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { createAnnouncementDirectUrl, readAnnouncementIdFromSearch, resolveAnnouncementDeepLink, withAnnouncementQuery } from "../lib/announcementDeepLink.ts";
import type { Announcement } from "../lib/announcements.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const base = mockAnnouncements[0];
const forGrade7: Announcement = { ...base, id: "g7", audiences: ["七年級導師"], publicationStatus: "published" };
const forAll: Announcement = { ...base, id: "all", audiences: ["全校教師"] };
const withdrawn: Announcement = { ...base, id: "gone", audiences: ["全校教師"], publicationStatus: "withdrawn" };
const list = [forGrade7, forAll, withdrawn];

test("直達連結採用 GitHub Pages base path 與 ?announcement={id}", () => {
  assert.equal(createAnnouncementDirectUrl("https://easyshih-ux.github.io/ysjh-info/", "abc123"), "https://easyshih-ux.github.io/ysjh-info/?announcement=abc123");
  assert.equal(createAnnouncementDirectUrl("https://easyshih-ux.github.io/ysjh-info/?x=1#top", "a b"), "https://easyshih-ux.github.io/ysjh-info/?announcement=a+b");
});

test("Query 解析只接受合理的公告 ID", () => {
  assert.equal(readAnnouncementIdFromSearch("?announcement=abc123"), "abc123");
  assert.equal(readAnnouncementIdFromSearch("?announcement=%20abc%20"), "abc");
  assert.equal(readAnnouncementIdFromSearch(""), null);
  assert.equal(readAnnouncementIdFromSearch("?announcement="), null);
  assert.equal(readAnnouncementIdFromSearch("?announcement=a/b"), null);
  assert.equal(readAnnouncementIdFromSearch(`?announcement=${"x".repeat(129)}`), null);
});

test("加入或移除公告參數時保留 base path 與其他 query", () => {
  assert.equal(withAnnouncementQuery("https://easyshih-ux.github.io/ysjh-info/?utm=line", "abc"), "/ysjh-info/?utm=line&announcement=abc");
  assert.equal(withAnnouncementQuery("https://easyshih-ux.github.io/ysjh-info/?announcement=abc", null), "/ysjh-info/");
});

test("符合身分篩選才開啟，不可透過 ID 繞過原本可見範圍", () => {
  assert.equal(resolveAnnouncementDeepLink(list, "g7", "七年級導師").status, "open");
  assert.equal(resolveAnnouncementDeepLink(list, "all", "八年級導師").status, "open");
  const blocked = resolveAnnouncementDeepLink(list, "g7", "八年級導師");
  assert.equal(blocked.status, "not-visible");
  assert.match(blocked.status === "not-visible" ? blocked.message : "", /八年級導師/);
  assert.equal(resolveAnnouncementDeepLink(list, "g7", "全部").status, "open");
  assert.equal(resolveAnnouncementDeepLink(list, "g7", "八年級導師", "all").status, "open");
});

test("公告不存在或已下架時顯示提示，不開啟", () => {
  assert.equal(resolveAnnouncementDeepLink(list, "missing", "全部").status, "not-found");
  assert.equal(resolveAnnouncementDeepLink(list, "gone", "全部").status, "not-found");
});

test("首頁直達：身分確認後才處理，支援 history 與 Dialog 關閉，相容 static export", () => {
  const page = source("app/page.tsx");
  assert.match(page, /if \(!locationState \|\| !identity \|\| announcementsLoading \|\| announcementsError\) return;/);
  assert.match(page, /resolveAnnouncementDeepLink\(announcements, announcementId, identity, viewMode\)/);
  assert.match(page, /addEventListener\("popstate"/);
  assert.match(page, /window\.history\.pushState\(null, "", url\)/);
  assert.match(page, /window\.history\.back\(\)/);
  assert.match(page, /onOpenChange=\{open => !open && closeAnnouncement\(\)\}/);
  assert.doesNotMatch(page, /useSearchParams/);
  assert.match(page, /readPublicAnnouncements\(\)/);
});
