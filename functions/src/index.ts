import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { isDepartment } from "./departments.js";

initializeApp();

const db = getFirestore();

export const approvePublisherRequest = onCall(
  { region: "asia-east1" },
  request => approvePublisherRequestHandler(request),
);

export async function approvePublisherRequestHandler(
  request: { auth?: { uid: string } | null; data: unknown },
  firestore: Firestore = db,
) {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "請先登入系統管理員帳號。");
    }

    const input = parseInput(request.data);
    const callerRef = firestore.collection("authorizedPublishers").doc(callerUid);
    const targetRequestRef = firestore.collection("publisherRequests").doc(input.targetUid);
    const targetProfileRef = firestore.collection("authorizedPublishers").doc(input.targetUid);

    await firestore.runTransaction(async transaction => {
      const [callerSnapshot, requestSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(callerRef),
        transaction.get(targetRequestRef),
        transaction.get(targetProfileRef),
      ]);

      const caller = callerSnapshot.data();
      if (!callerSnapshot.exists || caller?.enabled !== true || caller.role !== "systemAdmin") {
        throw new HttpsError("permission-denied", "只有系統管理員可以核准發布權限。");
      }

      if (!requestSnapshot.exists) {
        throw new HttpsError("not-found", "找不到待核准的發布權限申請。");
      }

      const publisherRequest = requestSnapshot.data();
      if (publisherRequest?.status !== "pending") {
        throw new HttpsError("failed-precondition", "此發布權限申請已不是待核准狀態。");
      }
      if (
        typeof publisherRequest.email !== "string"
        || !publisherRequest.email.trim()
        || !(publisherRequest.displayName === null || typeof publisherRequest.displayName === "string")
      ) {
        throw new HttpsError("failed-precondition", "發布權限申請資料不完整。");
      }

      const existingProfile = profileSnapshot.data();
      if (profileSnapshot.exists && existingProfile?.role === "systemAdmin") {
        throw new HttpsError(
          "failed-precondition",
          "系統管理員帳號不能透過發布權限申請改為一般發布者。",
        );
      }

      const now = FieldValue.serverTimestamp();
      transaction.set(targetProfileRef, {
        email: publisherRequest.email,
        displayName: publisherRequest.displayName,
        role: "publisher",
        enabled: true,
        defaultDepartment: input.defaultDepartment,
        createdAt: profileSnapshot.exists && existingProfile?.createdAt
          ? existingProfile.createdAt
          : now,
        createdBy: profileSnapshot.exists && typeof existingProfile?.createdBy === "string"
          ? existingProfile.createdBy
          : callerUid,
        updatedAt: now,
        updatedBy: callerUid,
      });
      transaction.update(targetRequestRef, { status: "approved" });
    });

    return { approved: true, targetUid: input.targetUid };
}

function parseInput(data: unknown) {
  if (!isRecord(data)) {
    throw new HttpsError("invalid-argument", "核准資料格式不正確。");
  }

  const keys = Object.keys(data);
  if (
    keys.length !== 2
    || !keys.includes("targetUid")
    || !keys.includes("defaultDepartment")
    || typeof data.targetUid !== "string"
    || data.targetUid.trim() !== data.targetUid
    || !data.targetUid
    || !isDepartment(data.defaultDepartment)
  ) {
    throw new HttpsError("invalid-argument", "核准資料只能包含有效的 targetUid 與發布單位。");
  }

  return {
    targetUid: data.targetUid,
    defaultDepartment: data.defaultDepartment,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
