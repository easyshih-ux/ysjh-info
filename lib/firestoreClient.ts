import { getFirestore, type Firestore } from "firebase/firestore";
import { getFirebaseApp } from "./firebaseClient.ts";
import type { Announcement } from "./announcements.ts";

export const ANNOUNCEMENTS_COLLECTION = "announcements";
export const AUTHORIZED_PUBLISHERS_COLLECTION = "authorizedPublishers";

// Firestore document IDs are stored outside the document body.
// All other fields stay aligned with the existing Announcement model.
export type FirestoreAnnouncement = Omit<Announcement, "id">;

export function getFirestoreClient(): Firestore {
  return getFirestore(getFirebaseApp());
}
