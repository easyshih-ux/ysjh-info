import type { FollowUp } from "./announcements.ts";
import type { AuthorizedPublisherContextValue } from "./publisherAccess.ts";

type WithdrawalPublisher = Pick<AuthorizedPublisherContextValue, "uid" | "role">;

export function canWithdrawManagedFollowUp(followUp: FollowUp, publisher: WithdrawalPublisher) {
  return Boolean(followUp.id)
    && (followUp.type === "supplement" || followUp.type === "reminder")
    && followUp.status !== "withdrawn"
    && (publisher.role === "systemAdmin" || followUp.authorUid === publisher.uid);
}
