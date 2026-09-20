import {
  getAuthorizedPublisher,
  normalizePublisherEmail,
} from "./authorizedPublishers.ts";
import type { Department } from "./departments.ts";
import type { PublisherProfileReadResult } from "./publisherProfile.ts";

export type AuthorizedPublisherAccess = "publisher" | "systemAdmin" | "legacy";

export interface AuthorizedPublisherContextValue {
  uid: string;
  access: AuthorizedPublisherAccess;
  role: "publisher" | "systemAdmin" | null;
  email: string;
  displayName: string | null;
  defaultDepartment: Department;
}

export type AdminAuthorizationState =
  | {
      status: "publisher" | "systemAdmin" | "legacy";
      publisher: AuthorizedPublisherContextValue;
    }
  | { status: "disabled" }
  | {
      status: "unauthorized";
      reason: "not-found" | "invalid-profile" | "legacy-not-allowed" | "read-error";
    };

export function resolvePublisherAccess(
  result: PublisherProfileReadResult,
  authenticatedEmail: string | null | undefined,
  authenticatedUid = "",
): AdminAuthorizationState {
  if (result.status === "disabled") return { status: "disabled" };
  if (result.status === "not-found") {
    return { status: "unauthorized", reason: "not-found" };
  }
  if (result.status === "error") {
    return { status: "unauthorized", reason: "read-error" };
  }
  if (result.status === "invalid") {
    return { status: "unauthorized", reason: "invalid-profile" };
  }

  if (result.status === "valid") {
    return {
      status: result.profile.role,
      publisher: {
        uid: authenticatedUid,
        access: result.profile.role,
        role: result.profile.role,
        email: result.profile.email,
        displayName: result.profile.displayName,
        defaultDepartment: result.profile.defaultDepartment,
      },
    };
  }

  const normalizedAuthenticatedEmail = normalizePublisherEmail(authenticatedEmail);
  const legacyPublisher = getAuthorizedPublisher(authenticatedEmail);

  // TODO V1.1: Remove legacy allowlist fallback after all production
  // authorizedPublishers documents have valid roles and production verification is complete.
  if (
    legacyPublisher
    && normalizedAuthenticatedEmail === result.profile.email
  ) {
    return {
      status: "legacy",
      publisher: {
        uid: authenticatedUid,
        access: "legacy",
        role: null,
        email: result.profile.email,
        displayName: result.profile.displayName,
        defaultDepartment: result.profile.defaultDepartment,
      },
    };
  }

  return { status: "unauthorized", reason: "legacy-not-allowed" };
}
