import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { announcementsForAcademicYear } from "../lib/academicYear.ts";
import { ANNOUNCEMENT_SORT_LABELS, ANNOUNCEMENT_SORT_MODES, announcementsForIdentity, filterAnnouncements, noticeLevelRank } from "../lib/announcementLogic.ts";
import type { Announcement, LineNotificationLevel } from "../lib/announcements.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const item = (id: string, level: LineNotificationLevel | undefined, publishedAt: string, overrides: Partial<Announcement> = {}): Announcement => ({
  ...mockAnnouncements[0], id, title: `公告 ${id}`, content: "內容", department: "設備組", audiences: ["全校教師"], academicYear: 115,
  lineNotificationLevel: level, publishedAt, ...overrides,
});
const items = [
  item("general-new", "general", "2026-10-20T08:00:00.000Z"),
  item("school-old", "schoolwide", "2026-10-01T08:00:00.000Z"),
  item("task-mid", "task", "2026-10-10T08:00:00.000Z"),
  item("legacy-newest", undefined, "2026-10-22T08:00:00.000Z"),
  item("required-new", "required", "2026-10-18T08:00:00.000Z"),
  item("school-new", "schoolwide", "2026-10-15T08:00:00.000Z"),
  item("required-old", "required", "2026-10-05T08:00:00.000Z"),
];
const ids = (list: Announcement[]) => list.map(entry => entry.id);

test("排序模式與標籤：最新優先為預設", () => {
  assert.deepEqual([...ANNOUNCEMENT_SORT_MODES], ["newest", "importance"]);
  assert.deepEqual(ANNOUNCEMENT_SORT_LABELS, { newest: "最新優先", importance: "重要程度優先" });
  assert.deepEqual(ids(filterAnnouncements(items, "", "全部", "全部")), ids(filterAnnouncements(items, "", "全部", "全部", "newest")));
});

test("最新優先維持 publishedAt 由新到舊，與原本結果相同", () => {
  assert.deepEqual(ids(filterAnnouncements(items, "", "全部", "全部")), ["legacy-newest", "general-new", "required-new", "school-new", "task-mid", "required-old", "school-old"]);
  const original = [...mockAnnouncements].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  assert.deepEqual(ids(filterAnnouncements(mockAnnouncements, "", "全部", "全部")), ids(original));
});

test("重要程度優先：全校必讀 → 重要必讀 → 待辦事項 → 一般公告，同級由新到舊；舊公告視為一般公告", () => {
  assert.deepEqual(ids(filterAnnouncements(items, "", "全部", "全部", "importance")), ["school-new", "school-old", "required-new", "required-old", "task-mid", "legacy-newest", "general-new"]);
  assert.deepEqual(["schoolwide", "required", "task", "general"].map(level => noticeLevelRank({ lineNotificationLevel: level as LineNotificationLevel })), [0, 1, 2, 3]);
  assert.equal(noticeLevelRank({ lineNotificationLevel: undefined }), 3);
  assert.equal(noticeLevelRank({ lineNotificationLevel: "urgent" as LineNotificationLevel }), 3);
});

test("兩種排序與搜尋、發布單位、學年度、身分篩選相容：筆數與內容相同，只差順序", () => {
  const data = [
    ...items,
    item("other-dept", "schoolwide", "2026-10-21T08:00:00.000Z", { department: "教學組" }),
    item("year-116", "schoolwide", "2026-10-21T08:00:00.000Z", { academicYear: 116 }),
    item("g7-only", "required", "2026-10-19T08:00:00.000Z", { audiences: ["七年級導師"] }),
    item("keyword", "task", "2026-10-02T08:00:00.000Z", { title: "防災演練" }),
  ];
  const scopes = [
    announcementsForAcademicYear(data, 115),
    announcementsForIdentity(announcementsForAcademicYear(data, 115), "八年級導師"),
    announcementsForAcademicYear(data, 116),
  ];
  for (const scoped of scopes) {
    for (const [query, department] of [["", "全部"], ["", "設備組"], ["防災", "全部"], ["公告", "教學組"]] as const) {
      const newest = filterAnnouncements(scoped, query, "全部", department, "newest");
      const importance = filterAnnouncements(scoped, query, "全部", department, "importance");
      assert.equal(importance.length, newest.length);
      assert.deepEqual(ids(importance).sort(), ids(newest).sort());
    }
  }
  assert.ok(!ids(filterAnnouncements(announcementsForIdentity(data, "八年級導師"), "", "全部", "全部", "importance")).includes("g7-only"));
});

test("畫面：搜尋區下方的切換按鈕，預設最新優先，不儲存偏好，切換學年度保留排序", () => {
  const page = source("app/page.tsx");
  assert.match(page, /const \[searchSort, setSearchSort\] = useState<AnnouncementSortMode>\("newest"\);/);
  assert.match(page, /filterAnnouncements\(scopedSearchAnnouncements, query, "全部", department, searchSort\)/);
  assert.match(page, /<\/select><\/label><\/div><\/div><div className="year-switch sort-switch" role="group" aria-label="排序方式">/);
  assert.match(page, /aria-pressed=\{searchSort === mode\} onClick=\{\(\) => setSearchSort\(mode\)\}/);
  assert.match(page, /onClick=\{\(\) => \{ setSearchAcademicYear\(year\); setQuery\(""\); \}\}/, "切換學年度不重設排序");
  assert.doesNotMatch(page, /localStorage\.[a-zA-Z]+\([^)]*[Ss]ort/);
  assert.equal(page.match(/searchSort/g)?.length, 5, "排序只作用於搜尋清單");
  assert.match(source("app/globals.css"), /\.sort-switch\{margin:12px 0 0;padding-bottom:0;border-bottom:0;flex-wrap:wrap\}/);
});
