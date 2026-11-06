/**
 * 公告保存方式（Gate 2：只儲存設定，不執行任何自動刪除）。
 *
 * - autoCleanup：依公告期限自動清理。未來以活動結束日或截止日為最後有效日期，
 *   滿 RETENTION_EXPIRY_MONTHS 個月後再經 RETENTION_GRACE_DAYS 天緩衝期，才符合永久刪除條件。
 * - longTerm：長期保留，不自動刪除（行政規定、常態性業務等）。
 * - 欄位不存在：舊公告，視為「尚未審查」，一律不得自動清理；由管理員集中審查（Gate 3）。
 */
export const RETENTION_POLICIES = ["autoCleanup", "longTerm"] as const;
export type RetentionPolicy = (typeof RETENTION_POLICIES)[number];
export type RetentionPolicyStatus = RetentionPolicy | "unreviewed";

/** 新公告預設值；舊公告不套用此預設。 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = "autoCleanup";
export const RETENTION_EXPIRY_MONTHS = 3;
export const RETENTION_GRACE_DAYS = 14;

export const RETENTION_POLICY_LABELS: Record<RetentionPolicyStatus, string> = {
  autoCleanup: "依公告期限自動清理",
  longTerm: "長期保留",
  unreviewed: "尚未審查",
};

export const RETENTION_POLICY_DESCRIPTIONS: Record<RetentionPolicy, string> = {
  autoCleanup: `功能啟用後，活動結束日或截止日滿 ${RETENTION_EXPIRY_MONTHS} 個月，再經 ${RETENTION_GRACE_DAYS} 天緩衝期才會清理`,
  longTerm: "適用於行政規定、常態性業務等，不自動刪除",
};

export function isRetentionPolicy(value: unknown): value is RetentionPolicy {
  return typeof value === "string" && RETENTION_POLICIES.includes(value as RetentionPolicy);
}

/** 讀取既有公告的保存狀態：沒有合法值即為尚未審查，不會回落成自動清理。 */
export function retentionPolicyStatus(value: unknown): RetentionPolicyStatus {
  return isRetentionPolicy(value) ? value : "unreviewed";
}

/** 只有明確設定為 autoCleanup 的公告，未來才可能進入自動清理流程。 */
export function isAutoCleanupAuthorized(item: { retentionPolicy?: unknown }) {
  return item.retentionPolicy === "autoCleanup";
}

/** 新公告的保存方式：未指定時使用預設（自動清理）。 */
export function resolveNewRetentionPolicy(value: unknown): RetentionPolicy {
  return isRetentionPolicy(value) ? value : DEFAULT_RETENTION_POLICY;
}

/**
 * 編輯既有公告時要寫入的保存方式。只有使用者明確選了合法值且與原值不同時才寫入；
 * 舊公告（未審查）未選擇時回傳空物件，絕不因儲存其他內容而補上預設值，也不刪除既有欄位。
 */
export function retentionPolicyPatch(original: { retentionPolicy?: unknown }, edited: { retentionPolicy?: unknown }): { retentionPolicy?: RetentionPolicy } {
  return isRetentionPolicy(edited.retentionPolicy) && edited.retentionPolicy !== original.retentionPolicy
    ? { retentionPolicy: edited.retentionPolicy }
    : {};
}

export function hasRetentionPolicyChanges(original: { retentionPolicy?: unknown }, edited: { retentionPolicy?: unknown }) {
  return "retentionPolicy" in retentionPolicyPatch(original, edited);
}
