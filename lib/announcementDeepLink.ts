import type { Announcement, UserIdentity } from "./announcements.ts";
import { announcementsForIdentity, type SavedIdentity } from "./announcementLogic.ts";

export const ANNOUNCEMENT_QUERY_PARAM = "announcement";

/** 產生公告直達連結，例如 https://easyshih-ux.github.io/ysjh-info/?announcement={id} */
export function createAnnouncementDirectUrl(siteUrl: string, announcementId: string) {
  const url = new URL(siteUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set(ANNOUNCEMENT_QUERY_PARAM, announcementId);
  return url.toString();
}

/** 從網址 query 取得公告 ID；格式不合理時視為沒有指定。 */
export function readAnnouncementIdFromSearch(search: string) {
  const value = new URLSearchParams(search).get(ANNOUNCEMENT_QUERY_PARAM)?.trim();
  return value && value.length <= 128 && !value.includes("/") ? value : null;
}

/** 回傳加入或移除公告參數後的網址（保留 path、其他 query 與 hash）。 */
export function withAnnouncementQuery(href: string, announcementId: string | null) {
  const url = new URL(href);
  if (announcementId) url.searchParams.set(ANNOUNCEMENT_QUERY_PARAM, announcementId);
  else url.searchParams.delete(ANNOUNCEMENT_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export type AnnouncementDeepLinkResult =
  | { status: "open"; announcement: Announcement }
  | { status: "not-found"; message: string }
  | { status: "not-visible"; message: string };

/**
 * 依既有身分篩選判斷公告直達連結能否開啟。
 * publicAnnouncements 應為已排除下架公告的公開清單；不可透過 ID 繞過原本可見範圍。
 */
export function resolveAnnouncementDeepLink(
  publicAnnouncements: readonly Announcement[],
  announcementId: string,
  identity: SavedIdentity,
  viewMode: "related" | "all" = "related",
): AnnouncementDeepLinkResult {
  const announcement = publicAnnouncements.find(item => item.id === announcementId && item.publicationStatus !== "withdrawn");
  if (!announcement) return { status: "not-found", message: "找不到這則公告，可能已下架或連結有誤。" };
  const visible = identity === "全部" || viewMode === "all" || announcementsForIdentity([announcement], identity as UserIdentity).length > 0;
  return visible
    ? { status: "open", announcement }
    : { status: "not-visible", message: `這則公告不在「${identity}」的相關公告範圍內。如需查看，請先切換身分。` };
}
