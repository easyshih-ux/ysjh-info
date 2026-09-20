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

export const listPublisherManagement = onCall(
  { region: "asia-east1" },
  request => listPublisherManagementHandler(request),
);

export const managePublisherAccess = onCall(
  { region: "asia-east1" },
  request => managePublisherAccessHandler(request),
);

export const manageAnnouncementLifecycle = onCall(
  { region: "asia-east1" },
  request => manageAnnouncementLifecycleHandler(request),
);

export async function manageAnnouncementLifecycleHandler(
  request: { auth?: { uid: string } | null; data: unknown },
  firestore: Firestore = db,
) {
  const callerUid = requireCallerUid(request.auth?.uid);
  const input = parseAnnouncementLifecycleInput(request.data);
  const callerRef = firestore.collection("authorizedPublishers").doc(callerUid);
  const announcementRef = firestore.collection("announcements").doc(input.announcementId);

  await firestore.runTransaction(async transaction => {
    const [callerSnapshot, announcementSnapshot] = await Promise.all([
      transaction.get(callerRef), transaction.get(announcementRef),
    ]);
    const caller = callerSnapshot.data();
    if (!callerSnapshot.exists || caller?.enabled !== true || !["publisher", "systemAdmin"].includes(String(caller.role))) {
      throw new HttpsError("permission-denied", "目前帳號沒有公告管理權限。");
    }
    if (!announcementSnapshot.exists) throw new HttpsError("not-found", "找不到公告。");
    const announcement = announcementSnapshot.data();
    const isSystemAdmin = caller?.role === "systemAdmin";
    if (!isSystemAdmin && announcement?.publisherUid !== callerUid) {
      throw new HttpsError("permission-denied", "只能管理自己發布的公告。");
    }
    if (input.action === "delete") {
      if (!isSystemAdmin) throw new HttpsError("permission-denied", "只有系統管理員可以永久刪除公告。");
      transaction.delete(announcementRef);
      return;
    }
    const now = FieldValue.serverTimestamp();
    if (input.action === "withdraw") {
      transaction.update(announcementRef, { publicationStatus: "withdrawn", withdrawnAt: now, withdrawnBy: callerUid });
    } else if (input.action === "restore") {
      transaction.update(announcementRef, { publicationStatus: "published", withdrawnAt: FieldValue.delete(), withdrawnBy: FieldValue.delete() });
    } else if (input.action === "startChase") {
      if (!Array.isArray(announcement?.deadlines) || announcement.deadlines.length === 0) {
        throw new HttpsError("failed-precondition", "只有設定截止期限的公告可以啟動催繳。");
      }
      transaction.update(announcementRef, {
        collectionStatus: "chasing",
        collectionMessage: input.message,
        collectionStartedAt: now,
        collectionStartedBy: callerUid,
      });
    } else {
      transaction.update(announcementRef, {
        collectionStatus: FieldValue.delete(),
        collectionMessage: FieldValue.delete(),
        collectionStartedAt: FieldValue.delete(),
        collectionStartedBy: FieldValue.delete(),
      });
    }
  });
  return { success: true, announcementId: input.announcementId, action: input.action };
}

export async function listPublisherManagementHandler(
  request: { auth?: { uid: string } | null },
  firestore: Firestore = db,
) {
  const callerUid = requireCallerUid(request.auth?.uid);
  const caller = await firestore.collection("authorizedPublishers").doc(callerUid).get();
  assertSystemAdmin(caller.exists, caller.data());
  const [profiles, requests] = await Promise.all([
    firestore.collection("authorizedPublishers").get(),
    firestore.collection("publisherRequests").get(),
  ]);
  return {
    publishers: profiles.docs.flatMap(snapshot => {
      const data = snapshot.data();
      if (!isRecord(data) || !["publisher", "systemAdmin"].includes(String(data.role))) return [];
      return [{
        uid: snapshot.id,
        email: typeof data.email === "string" ? data.email : "",
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        role: data.role,
        enabled: data.enabled === true,
        defaultDepartment: isDepartment(data.defaultDepartment) ? data.defaultDepartment : null,
      }];
    }),
    requests: requests.docs.flatMap(snapshot => {
      const data = snapshot.data();
      if (!isRecord(data) || data.status !== "pending" || typeof data.email !== "string") return [];
      return [{
        uid: snapshot.id,
        email: data.email,
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        requestedAtMillis: toMillis(data.requestedAt),
        status: "pending" as const,
      }];
    }),
  };
}

export async function managePublisherAccessHandler(
  request: { auth?: { uid: string } | null; data: unknown },
  firestore: Firestore = db,
) {
  const callerUid = requireCallerUid(request.auth?.uid);
  const input = parseManagementInput(request.data);
  const callerRef = firestore.collection("authorizedPublishers").doc(callerUid);
  const profileRef = firestore.collection("authorizedPublishers").doc(input.targetUid);
  const requestRef = firestore.collection("publisherRequests").doc(input.targetUid);

  await firestore.runTransaction(async transaction => {
    const [callerSnapshot, profileSnapshot, requestSnapshot] = await Promise.all([
      transaction.get(callerRef), transaction.get(profileRef), transaction.get(requestRef),
    ]);
    assertSystemAdmin(callerSnapshot.exists, callerSnapshot.data());

    if (input.action === "reject") {
      if (!requestSnapshot.exists || requestSnapshot.data()?.status !== "pending") {
        throw new HttpsError("failed-precondition", "此申請已不是待核准狀態。");
      }
      transaction.update(requestRef, { status: "rejected" });
      return;
    }

    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists) throw new HttpsError("not-found", "找不到發布者帳號。");
    if (profile?.role === "systemAdmin") {
      throw new HttpsError("failed-precondition", "不能透過發布者管理變更系統管理員帳號。");
    }
    if (profile?.role !== "publisher") throw new HttpsError("failed-precondition", "發布者角色資料不正確。");
    const update = input.action === "changeDepartment"
      ? { defaultDepartment: input.defaultDepartment, updatedAt: FieldValue.serverTimestamp(), updatedBy: callerUid }
      : { enabled: input.action === "enable", updatedAt: FieldValue.serverTimestamp(), updatedBy: callerUid };
    transaction.update(profileRef, update);
  });
  return { success: true, targetUid: input.targetUid, action: input.action };
}

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

function parseManagementInput(data: unknown) {
  if (!isRecord(data) || typeof data.targetUid !== "string" || !data.targetUid || data.targetUid.trim() !== data.targetUid) {
    throw new HttpsError("invalid-argument", "發布者管理資料格式不正確。");
  }
  const action = data.action;
  if (!["reject", "disable", "enable", "changeDepartment"].includes(String(action))) {
    throw new HttpsError("invalid-argument", "不支援此發布者管理動作。");
  }
  const expectedKeys = action === "changeDepartment" ? 3 : 2;
  if (Object.keys(data).length !== expectedKeys) throw new HttpsError("invalid-argument", "發布者管理欄位不正確。");
  if (action === "changeDepartment" && !isDepartment(data.defaultDepartment)) {
    throw new HttpsError("invalid-argument", "請選擇正式發布單位。");
  }
  return {
    targetUid: data.targetUid,
    action: action as "reject" | "disable" | "enable" | "changeDepartment",
    defaultDepartment: data.defaultDepartment,
  };
}

function parseAnnouncementLifecycleInput(data: unknown) {
  if (!isRecord(data) || typeof data.announcementId !== "string" || !data.announcementId || data.announcementId.trim() !== data.announcementId) {
    throw new HttpsError("invalid-argument", "公告管理資料格式不正確。");
  }
  const action = data.action;
  if (!["withdraw", "restore", "startChase", "stopChase", "delete"].includes(String(action))) {
    throw new HttpsError("invalid-argument", "不支援此公告管理動作。");
  }
  const expectedKeys = action === "startChase" ? 3 : 2;
  if (Object.keys(data).length !== expectedKeys || (action === "startChase" && typeof data.message !== "string")) {
    throw new HttpsError("invalid-argument", "公告管理欄位不正確。");
  }
  return {
    announcementId: data.announcementId,
    action: action as "withdraw" | "restore" | "startChase" | "stopChase" | "delete",
    message: typeof data.message === "string" ? data.message.trim().slice(0, 300) : "",
  };
}

function requireCallerUid(uid: string | undefined) {
  if (!uid) throw new HttpsError("unauthenticated", "請先登入系統管理員帳號。");
  return uid;
}

function assertSystemAdmin(exists: boolean, data: FirebaseFirestore.DocumentData | undefined) {
  if (!exists || data?.enabled !== true || data.role !== "systemAdmin") {
    throw new HttpsError("permission-denied", "只有系統管理員可以管理發布權限。");
  }
}

function toMillis(value: unknown) {
  if (isRecord(value) && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
