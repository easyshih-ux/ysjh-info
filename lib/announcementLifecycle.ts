import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp } from "./firebaseClient.ts";

export type AnnouncementLifecycleAction = "withdraw" | "restore" | "startChase" | "stopChase" | "delete";

export async function manageAnnouncementLifecycle(
  announcementId: string,
  action: AnnouncementLifecycleAction,
  message = "",
) {
  const callable = httpsCallable(
    getFunctions(getFirebaseApp(), "asia-east1"),
    "manageAnnouncementLifecycle",
  );
  await callable(action === "startChase" ? { announcementId, action, message } : { announcementId, action });
}
