import { USER_IDENTITIES, type Announcement, type Audience, type ImageAttachment, type StoredImageAudiences, type UserIdentity } from "./announcements.ts";
import { SCHOOLWIDE_INCLUDES_ADMIN, type SavedIdentity } from "./announcementLogic.ts";

/** Firestore Rules 也限制最多 5 筆，與每篇最多 5 張圖片一致。 */
export const MAX_IMAGE_AUDIENCE_ENTRIES = 5;

export type ImageAudienceStatus =
  | { kind: "shared" }
  | { kind: "targeted"; identities: UserIdentity[] }
  | { kind: "invalid" };

const isUserIdentity = (value: unknown): value is UserIdentity => typeof value === "string" && USER_IDENTITIES.includes(value as UserIdentity);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** 圖片可指定的身分只能來自公告接收對象；「全校教師」對應全部五種身分（行政依 SCHOOLWIDE_INCLUDES_ADMIN）。 */
export function allowedImageIdentities(audiences: readonly Audience[]): UserIdentity[] {
  if (audiences.includes("全校教師")) return USER_IDENTITIES.filter(identity => identity !== "行政" || SCHOOLWIDE_INCLUDES_ADMIN);
  return USER_IDENTITIES.filter(identity => audiences.includes(identity));
}

/**
 * 讀取 Firestore：只保留可能是圖片 ID 的鍵；值為字串清單時保留原值（之後再判斷是否合法），
 * 其他格式一律記為 null（異常）。不會把異常轉為共用。
 */
export function parseStoredImageAudiences(value: unknown): StoredImageAudiences | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(([key]) => key.trim().length > 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, raw]) => [key, Array.isArray(raw) && raw.every(item => typeof item === "string") ? [...raw] : null]));
}

/** 單張圖片的身分狀態：沒有標記為共用；有標記但空清單、不明身分、重複或不在接收對象內，一律異常。 */
export function imageAudienceStatus(announcement: Pick<Announcement, "audiences" | "imageAudiences">, imageId: string): ImageAudienceStatus {
  const map = announcement.imageAudiences;
  if (!map || !Object.prototype.hasOwnProperty.call(map, imageId)) return { kind: "shared" };
  const raw = map[imageId];
  if (!Array.isArray(raw) || raw.length === 0) return { kind: "invalid" };
  const allowed = allowedImageIdentities(announcement.audiences);
  const unique = new Set(raw);
  if (unique.size !== raw.length || !raw.every(item => isUserIdentity(item) && allowed.includes(item))) return { kind: "invalid" };
  return { kind: "targeted", identities: USER_IDENTITIES.filter(identity => unique.has(identity)) };
}

/**
 * 教師端：須先通過原有公告篩選，才呼叫此函式。
 * 一般模式：共用＋符合目前身分的圖片；異常一律隱藏。查看全部或身分「全部」：顯示全部並附狀態。
 */
export function visibleImagesFor(
  announcement: Pick<Announcement, "audiences" | "imageAudiences" | "attachments">,
  identity: SavedIdentity | null | undefined,
  viewMode: "related" | "all",
) {
  const showAll = viewMode === "all" || identity === "全部";
  return announcement.attachments
    .filter((attachment): attachment is ImageAttachment => attachment.type === "image")
    .map(image => ({ image, status: imageAudienceStatus(announcement, image.id) }))
    .filter(({ status }) => showAll
      || status.kind === "shared"
      || (status.kind === "targeted" && !!identity && status.identities.includes(identity as typeof status.identities[number])));
}

/** 編輯狀態：圖片 ID → 已勾選的身分；空清單代表共用；"invalid" 代表沿用的異常標記，須重新設定。 */
export type ImageAudienceSelections = Record<string, UserIdentity[] | "invalid">;

export function imageAudienceSelectionsFrom(announcement: Pick<Announcement, "audiences" | "imageAudiences" | "attachments">): ImageAudienceSelections {
  const selections: ImageAudienceSelections = {};
  for (const attachment of announcement.attachments) {
    if (attachment.type !== "image") continue;
    const status = imageAudienceStatus(announcement, attachment.id);
    if (status.kind === "targeted") selections[attachment.id] = status.identities;
    if (status.kind === "invalid") selections[attachment.id] = "invalid";
  }
  return selections;
}

/** 儲存前驗證：回傳不合法圖片的順序（從 1 起算）與提示文字。 */
export function validateImageAudienceSelections(imageIds: readonly string[], selections: ImageAudienceSelections, audiences: readonly Audience[]) {
  const allowed = allowedImageIdentities(audiences);
  const invalidPositions = imageIds.flatMap((id, index) => {
    const selected = selections[id];
    if (selected === undefined) return [];
    if (selected === "invalid") return [index + 1];
    return selected.every(identity => allowed.includes(identity)) && new Set(selected).size === selected.length ? [] : [index + 1];
  });
  return invalidPositions.length
    ? `第 ${invalidPositions.join("、")} 張圖片的適用身分已不在公告對象中或設定異常，請重新設定`
    : undefined;
}

/**
 * 轉為寫入 Firestore 的值：移除不存在的圖片與空清單（共用）。
 * 已勾選的身分一律保留（即使等於全部可選身分），避免日後擴大接收對象時，指定身分的圖片意外變成共用。
 * 呼叫前須先通過 validateImageAudienceSelections。全部共用時回傳 undefined（不寫入或清除欄位）。
 */
export function imageAudiencesForSave(imageIds: readonly string[], selections: ImageAudienceSelections): Record<string, UserIdentity[]> | undefined {
  const entries = imageIds.flatMap(id => {
    const selected = selections[id];
    if (!selected || selected === "invalid" || selected.length === 0) return [];
    return [[id, USER_IDENTITIES.filter(identity => selected.includes(identity))] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** 是否需要顯示身分勾選：可選身分超過一種，或這張圖片已有標記（包含異常），以免既有標記被隱藏。 */
export function shouldShowImageAudiencePicker(allowed: readonly UserIdentity[], selected: UserIdentity[] | "invalid" | undefined) {
  return allowed.length > 1 || selected === "invalid" || (selected?.length ?? 0) > 0;
}

/** 同一張圖片是否有不合法的勾選（不在接收對象內或沿用的異常標記）。 */
export function hasInvalidImageAudienceSelection(allowed: readonly UserIdentity[], selected: UserIdentity[] | "invalid" | undefined) {
  return selected === "invalid" || (selected ?? []).some(identity => !allowed.includes(identity));
}

export function formatImageAudienceLabel(status: ImageAudienceStatus) {
  if (status.kind === "shared") return "共用";
  if (status.kind === "invalid") return "⚠ 身分設定異常";
  return status.identities.join("、");
}

/** 比較兩份對照表是否實質相同（忽略鍵與身分的排列順序）；用於判斷編輯時是否需要寫入。 */
export function sameImageAudiences(a: StoredImageAudiences | undefined, b: StoredImageAudiences | undefined) {
  const canonical = (map: StoredImageAudiences | undefined) => JSON.stringify(Object.keys(map ?? {}).sort().map(key => {
    const value = map![key];
    return [key, Array.isArray(value) ? [...value].sort() : null];
  }));
  return canonical(a) === canonical(b);
}
