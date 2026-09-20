import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { Department } from "./departments.ts";
import { getFirebaseApp } from "./firebaseClient.ts";
import {
  getFirestoreClient,
  PUBLISHER_REQUESTS_COLLECTION,
} from "./firestoreClient.ts";

export interface PendingPublisherRequest {
  uid: string;
  email: string;
  displayName: string | null;
  requestedAt: Timestamp;
  status: "pending";
}

export async function approvePublisherRequest(
  targetUid: string,
  defaultDepartment: Department,
) {
  const functions = getFunctions(getFirebaseApp(), "asia-east1");
  const approve = httpsCallable<
    { targetUid: string; defaultDepartment: Department },
    { approved: true; targetUid: string }
  >(functions, "approvePublisherRequest");
  await approve({ targetUid, defaultDepartment });
}

export async function listPendingPublisherRequests(): Promise<PendingPublisherRequest[]> {
  const snapshot = await getDocs(
    collection(getFirestoreClient(), PUBLISHER_REQUESTS_COLLECTION),
  );

  return snapshot.docs
    .map(item => parsePendingPublisherRequest(item.id, item.data()))
    .filter((item): item is PendingPublisherRequest => item !== null)
    .sort((a, b) => a.requestedAt.toMillis() - b.requestedAt.toMillis());
}

export function parsePendingPublisherRequest(
  uid: string,
  data: unknown,
): PendingPublisherRequest | null {
  if (!isRecord(data) || data.status !== "pending") return null;
  if (typeof data.email !== "string" || !data.email.trim()) return null;
  if (!(data.displayName === null || typeof data.displayName === "string")) return null;
  if (!isTimestamp(data.requestedAt)) return null;

  return {
    uid,
    email: data.email.trim(),
    displayName: data.displayName,
    requestedAt: data.requestedAt,
    status: "pending",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is Timestamp {
  if (!isRecord(value)) return false;
  return typeof value.seconds === "number"
    && typeof value.nanoseconds === "number"
    && typeof value.toDate === "function"
    && typeof value.toMillis === "function";
}
