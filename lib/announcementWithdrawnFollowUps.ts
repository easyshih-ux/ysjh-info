import type { FollowUp } from "./announcements.ts";

export const WITHDRAWN_FOLLOW_UP_GRACE_MS = 5 * 60 * 1000;

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function isHandSlipWithdrawal(followUp: FollowUp) {
  if (followUp.status !== "withdrawn") return false;
  const createdAt = timestamp(followUp.createdAt);
  const withdrawnAt = timestamp(followUp.withdrawnAt);
  if (createdAt === null || withdrawnAt === null) return false;
  const elapsed = withdrawnAt - createdAt;
  return elapsed >= 0 && elapsed <= WITHDRAWN_FOLLOW_UP_GRACE_MS;
}

export function activeOriginalFollowUps(followUps: readonly FollowUp[]) {
  return followUps.filter(item => item.type !== "related" && item.status !== "withdrawn");
}

export function visibleWithdrawnFollowUps(followUps: readonly FollowUp[]) {
  return followUps
    .filter(item => item.type !== "related" && item.status === "withdrawn" && !isHandSlipWithdrawal(item))
    .sort((a, b) => (timestamp(b.withdrawnAt) ?? Number.NEGATIVE_INFINITY) - (timestamp(a.withdrawnAt) ?? Number.NEGATIVE_INFINITY));
}
