import type { Timestamp } from "firebase/firestore";
import { isDepartment, type Department } from "./departments.ts";

export const PUBLISHER_ROLES = ["systemAdmin", "publisher"] as const;
export type PublisherRole = (typeof PUBLISHER_ROLES)[number];

export const PUBLISHER_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type PublisherRequestStatus = (typeof PUBLISHER_REQUEST_STATUSES)[number];

export interface PublisherProfile {
  email: string;
  displayName: string | null;
  role: PublisherRole;
  enabled: boolean;
  defaultDepartment: Department;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

export interface PublisherRequest {
  email: string;
  displayName: string | null;
  requestedAt: Timestamp;
  lastSeenAt: Timestamp;
  status: PublisherRequestStatus;
  requestedDepartment: string;
}

export function isPublisherRole(value: unknown): value is PublisherRole {
  return typeof value === "string" && PUBLISHER_ROLES.includes(value as PublisherRole);
}

export function isPublisherRequestStatus(value: unknown): value is PublisherRequestStatus {
  return typeof value === "string"
    && PUBLISHER_REQUEST_STATUSES.includes(value as PublisherRequestStatus);
}

export function hasValidPublisherProfileCore(
  profile: Pick<PublisherProfile, "email" | "role" | "enabled" | "defaultDepartment">,
) {
  return profile.email.trim().length > 0
    && isPublisherRole(profile.role)
    && typeof profile.enabled === "boolean"
    && isDepartment(profile.defaultDepartment);
}
