import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  getFirestoreClient,
  PUBLISHER_REQUESTS_COLLECTION,
} from "./firestoreClient.ts";
import { isPublisherRequestDepartment } from "./departments.ts";

export type PublisherRequestReadResult =
  | { status: "not-found" }
  | { status: "pending" }
  | { status: "rejected" }
  | { status: "invalid" }
  | { status: "error" };

export async function readPublisherRequest(uid: string): Promise<PublisherRequestReadResult> {
  try {
    const snapshot = await getDoc(
      doc(getFirestoreClient(), PUBLISHER_REQUESTS_COLLECTION, uid),
    );
    if (!snapshot.exists()) return { status: "not-found" };

    const status = snapshot.data().status;
    if (status === "pending" || status === "rejected") return { status };
    return { status: "invalid" };
  } catch {
    return { status: "error" };
  }
}

export async function createPublisherRequest({
  uid,
  email,
  displayName,
  requestedDepartment,
}: {
  uid: string;
  email: string;
  displayName: string | null;
  requestedDepartment: string;
}) {
  if (!isPublisherRequestDepartment(requestedDepartment)) throw new Error("invalid-department");
  await setDoc(
    doc(getFirestoreClient(), PUBLISHER_REQUESTS_COLLECTION, uid),
    {
      email,
      displayName,
      requestedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      status: "pending",
      requestedDepartment,
    },
  );
}
