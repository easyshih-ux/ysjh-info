import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp } from "./firebaseClient.ts";
import { isDepartment, type Department } from "./departments.ts";

export interface PendingPublisherRequest { uid: string; email: string; displayName: string | null; requestedAtMillis: number; status: "pending" }
export interface ManagedPublisher { uid: string; email: string; displayName: string | null; role: "publisher" | "systemAdmin"; enabled: boolean; defaultDepartment: Department | null }
export interface PublisherManagementOverview { requests: PendingPublisherRequest[]; publishers: ManagedPublisher[] }

const functions = () => getFunctions(getFirebaseApp(), "asia-east1");

export async function approvePublisherRequest(targetUid: string, defaultDepartment: Department) {
  if (!isDepartment(defaultDepartment)) throw new Error("invalid-department");
  const callable = httpsCallable(functions(), "approvePublisherRequest");
  await callable({ targetUid, defaultDepartment });
}

export async function listPublisherManagement(): Promise<PublisherManagementOverview> {
  const callable = httpsCallable<Record<string, never>, PublisherManagementOverview>(functions(), "listPublisherManagement");
  const result = await callable({});
  return {
    requests: result.data.requests.slice().sort((a, b) => a.requestedAtMillis - b.requestedAtMillis),
    publishers: result.data.publishers.slice().sort((a, b) => a.email.localeCompare(b.email)),
  };
}

export async function rejectPublisherRequest(targetUid: string) { await managePublisherAccess(targetUid, "reject"); }
export async function setPublisherEnabled(targetUid: string, enabled: boolean) { await managePublisherAccess(targetUid, enabled ? "enable" : "disable"); }
export async function changePublisherDepartment(targetUid: string, defaultDepartment: Department) {
  if (!isDepartment(defaultDepartment)) throw new Error("invalid-department");
  await managePublisherAccess(targetUid, "changeDepartment", defaultDepartment);
}

async function managePublisherAccess(targetUid: string, action: "reject" | "enable" | "disable" | "changeDepartment", defaultDepartment?: Department) {
  const callable = httpsCallable(functions(), "managePublisherAccess");
  await callable(action === "changeDepartment" ? { targetUid, action, defaultDepartment } : { targetUid, action });
}
