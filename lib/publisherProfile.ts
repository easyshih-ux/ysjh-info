import { doc, getDoc, type Timestamp } from "firebase/firestore";
import { isDepartment, type Department } from "./departments.ts";
import {
  AUTHORIZED_PUBLISHERS_COLLECTION,
  getFirestoreClient,
} from "./firestoreClient.ts";
import {
  isPublisherRole,
  type PublisherProfile,
} from "./publisherAuthorization.ts";

export interface LegacyPublisherProfile {
  email: string;
  displayName: string | null;
  enabled: true;
  defaultDepartment: Department;
}

export type PublisherProfileReadResult =
  | { status: "valid"; profile: PublisherProfile }
  | { status: "legacy"; profile: LegacyPublisherProfile }
  | { status: "disabled"; email: string | null }
  | { status: "not-found" }
  | { status: "invalid"; reason: "invalid-role" | "incomplete-schema" }
  | { status: "error" };

export async function readPublisherProfile(uid: string): Promise<PublisherProfileReadResult> {
  try {
    const snapshot = await getDoc(
      doc(getFirestoreClient(), AUTHORIZED_PUBLISHERS_COLLECTION, uid),
    );
    if (!snapshot.exists()) return { status: "not-found" };
    return parsePublisherProfileDocument(snapshot.data());
  } catch {
    return { status: "error" };
  }
}

export function parsePublisherProfileDocument(data: unknown): PublisherProfileReadResult {
  if (!isRecord(data)) return { status: "invalid", reason: "incomplete-schema" };

  const email = typeof data.email === "string" && data.email.trim()
    ? data.email.trim().toLowerCase()
    : null;

  // An explicit disabled state always wins over the legacy allowlist fallback.
  if (data.enabled === false) return { status: "disabled", email };
  if (data.enabled !== true || !email || !isDepartment(data.defaultDepartment)) {
    return { status: "invalid", reason: "incomplete-schema" };
  }

  const displayName = data.displayName === null || typeof data.displayName === "string"
    ? data.displayName
    : null;

  if (!("role" in data)) {
    return {
      status: "legacy",
      profile: {
        email,
        displayName,
        enabled: true,
        defaultDepartment: data.defaultDepartment,
      },
    };
  }

  if (!isPublisherRole(data.role)) {
    return { status: "invalid", reason: "invalid-role" };
  }

  if (
    !(data.displayName === null || typeof data.displayName === "string")
    || !isTimestamp(data.createdAt)
    || typeof data.createdBy !== "string"
    || !data.createdBy.trim()
    || !isTimestamp(data.updatedAt)
    || typeof data.updatedBy !== "string"
    || !data.updatedBy.trim()
  ) {
    return { status: "invalid", reason: "incomplete-schema" };
  }

  return {
    status: "valid",
    profile: {
      email,
      displayName,
      role: data.role,
      enabled: true,
      defaultDepartment: data.defaultDepartment,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
      updatedAt: data.updatedAt,
      updatedBy: data.updatedBy,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is Timestamp {
  if (!isRecord(value)) return false;
  return typeof value.seconds === "number"
    && typeof value.nanoseconds === "number"
    && typeof value.toDate === "function";
}
