import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  collectionGroup,
} from "firebase/firestore";

const TEST_PROJECT_ID = "demo-ysjh-info-rules-test";
const VERIFIED_EMAIL = "user-a@example.test";
let testEnvironment;

before(async () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const match = emulatorHost.match(/^(127\.0\.0\.1|localhost):(\d+)$/);
  if (!match) {
    throw new Error("Rules tests require a local FIRESTORE_EMULATOR_HOST.");
  }

  testEnvironment = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    firestore: {
      host: match[1],
      port: Number(match[2]),
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

afterEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

function anonymousDb() {
  return testEnvironment.unauthenticatedContext().firestore();
}

function userDb(uid, overrides = {}) {
  return testEnvironment.authenticatedContext(uid, {
    email: `${uid}@example.test`,
    email_verified: true,
    ...overrides,
  }).firestore();
}

async function seed(path, data) {
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

function profile(role = "publisher", enabled = true) {
  return { role, enabled, email: "seed@example.test", defaultDepartment: "設備組" };
}

function requestData(email = VERIFIED_EMAIL, overrides = {}) {
  return {
    email,
    displayName: "Test User",
    requestedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    status: "pending",
    requestedDepartment: "設備組",
    ...overrides,
  };
}

function announcementData(title = "Emulator announcement", publisherUid = "userA") {
  return { title, content: "Rules integration test only", publisherUid, publicationStatus: "published", department: "設備組" };
}

function followUpData(overrides = {}) {
  return {
    type: "supplement",
    message: "補充內容",
    authorUid: "userA",
    department: "設備組",
    status: "active",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function pdfAttachment(id, publisherUid = "userA") {
  return {
    id,
    type: "pdf",
    url: `https://example.test/${id}.pdf`,
    name: `${id}.pdf`,
    sizeBytes: 1024,
    storagePath: `announcements/newA/pdf/${publisherUid}/${id}.pdf`,
    contentType: "application/pdf",
  };
}

test("01 未登入者不能 get publisher profile", async () => {
  await seed("authorizedPublishers/userA", profile());
  await assertFails(getDoc(doc(anonymousDb(), "authorizedPublishers/userA")));
});

test("02 user A 可以 get 自己的 publisher profile", async () => {
  await seed("authorizedPublishers/userA", profile());
  await assertSucceeds(getDoc(doc(userDb("userA"), "authorizedPublishers/userA")));
});

test("03 user A 不能 get user B 的 publisher profile", async () => {
  await seed("authorizedPublishers/userB", profile());
  await assertFails(getDoc(doc(userDb("userA"), "authorizedPublishers/userB")));
});

test("04 publisher 不能 create authorizedPublishers", async () => {
  await seed("authorizedPublishers/userA", profile("publisher"));
  await assertFails(setDoc(doc(userDb("userA"), "authorizedPublishers/userB"), profile()));
});

test("05 publisher 不能 update authorizedPublishers", async () => {
  await seed("authorizedPublishers/userA", profile("publisher"));
  await assertFails(updateDoc(doc(userDb("userA"), "authorizedPublishers/userA"), { enabled: false }));
});

test("06 publisher 不能 delete authorizedPublishers", async () => {
  await seed("authorizedPublishers/userA", profile("publisher"));
  await assertFails(deleteDoc(doc(userDb("userA"), "authorizedPublishers/userA")));
});

test("07 systemAdmin browser client 不能 create update delete authorizedPublishers", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin"));
  const database = userDb("adminA");
  await assertFails(setDoc(doc(database, "authorizedPublishers/userB"), profile()));
  await assertFails(updateDoc(doc(database, "authorizedPublishers/adminA"), { enabled: false }));
  await assertFails(deleteDoc(doc(database, "authorizedPublishers/adminA")));
});

test("08 client 不能 list authorizedPublishers", async () => {
  await seed("authorizedPublishers/userA", profile());
  await assertFails(getDocs(collection(userDb("userA"), "authorizedPublishers")));
});

test("09 未登入者不能建立 publisherRequest", async () => {
  await assertFails(setDoc(doc(anonymousDb(), "publisherRequests/userA"), requestData(VERIFIED_EMAIL)));
});

test("10 verified user 可以建立自己的 publisherRequest", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertSucceeds(setDoc(doc(database, "publisherRequests/userA"), requestData()));
});

test("10a 舊版申請文件缺少 requestedDepartment 仍相容", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  const legacy = requestData();
  delete legacy.requestedDepartment;
  await assertSucceeds(setDoc(doc(database, "publisherRequests/userA"), legacy));
});

test("10b publisherRequest 申請單位只接受22個固定單位或其他", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertSucceeds(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, { requestedDepartment: "人事室" })));
  await testEnvironment.clearFirestore();
  await assertSucceeds(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, { requestedDepartment: "其他" })));
  await testEnvironment.clearFirestore();
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, { requestedDepartment: "家長會" })));
});

test("11 user 不能替別人的 UID 建立 publisherRequest", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userB"), requestData()));
});

test("12 publisherRequest email 必須符合 auth token", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData("other@example.test")));
});

test("13 email_verified 不為 true 時不能建立 publisherRequest", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL, email_verified: false });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData()));
});

test("14 publisherRequest status 只能是 pending", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, { status: "approved" })));
});

test("15 publisherRequest 不能加入 role", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, { role: "systemAdmin" })));
});

test("16 publisherRequest 不能加入 enabled", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, { enabled: true })));
});

test("17 publisherRequest 不能加入 approvedBy", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, { approvedBy: "userA" })));
});

test("18 requestedAt 必須等於 request.time", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, {
    requestedAt: Timestamp.fromMillis(0),
  })));
});

test("19 lastSeenAt 必須等於 request.time", async () => {
  const database = userDb("userA", { email: VERIFIED_EMAIL });
  await assertFails(setDoc(doc(database, "publisherRequests/userA"), requestData(VERIFIED_EMAIL, {
    lastSeenAt: Timestamp.fromMillis(0),
  })));
});

test("20 user 可以 get 自己的 publisherRequest", async () => {
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertSucceeds(getDoc(doc(userDb("userA"), "publisherRequests/userA")));
});

test("21 user 不能 get 別人的 publisherRequest", async () => {
  await seed("publisherRequests/userB", { email: "user-b@example.test", status: "pending" });
  await assertFails(getDoc(doc(userDb("userA"), "publisherRequests/userB")));
});

test("22 client 不能 list publisherRequests", async () => {
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertFails(getDocs(collection(userDb("userA"), "publisherRequests")));
});

test("23 client 不能 update publisherRequest", async () => {
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertFails(updateDoc(doc(userDb("userA"), "publisherRequests/userA"), { status: "approved" }));
});

test("24 client 不能 delete publisherRequest", async () => {
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertFails(deleteDoc(doc(userDb("userA"), "publisherRequests/userA")));
});

test("25 未登入者可以 read 公開 announcement", async () => {
  await seed("announcements/publicA", announcementData());
  await assertSucceeds(getDoc(doc(anonymousDb(), "announcements/publicA")));
});

test("26 未授權登入者不能 create announcement", async () => {
  await assertFails(setDoc(doc(userDb("userA"), "announcements/newA"), announcementData()));
});

test("27 只有 pending request 不能 create announcement", async () => {
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertFails(setDoc(doc(userDb("userA"), "announcements/newA"), announcementData()));
});

test("28 enabled publisher 可以 create announcement", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await assertSucceeds(setDoc(doc(userDb("userA"), "announcements/newA"), announcementData()));
});

test("28b publisher 只能使用 profile 核准的固定或自訂單位", async () => {
  await seed("authorizedPublishers/userA", { ...profile("publisher", true), defaultDepartment: "家長會" });
  const database = userDb("userA");
  await assertSucceeds(setDoc(doc(database, "announcements/customA"), { ...announcementData(), department: "家長會" }));
  await assertFails(setDoc(doc(database, "announcements/fixedA"), { ...announcementData(), department: "人事室" }));
  await assertFails(setDoc(doc(database, "announcements/foreignA"), { ...announcementData(), department: "校友會" }));
});

test("29 enabled publisher 可以 update announcement", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/existingA", announcementData());
  await assertSucceeds(updateDoc(doc(userDb("userA"), "announcements/existingA"), { title: "Updated" }));
  await assertFails(updateDoc(doc(userDb("userA"), "announcements/existingA"), { department: "教務處" }));
});

test("30 enabled systemAdmin 可以 create announcement", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await assertSucceeds(setDoc(doc(userDb("adminA"), "announcements/newA"), announcementData("Emulator announcement", "adminA")));
  await assertSucceeds(setDoc(doc(userDb("adminA"), "announcements/customAdmin"), { ...announcementData("Custom", "adminA"), department: "教師會" }));
});

test("31 enabled systemAdmin 可以 update announcement", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/existingA", announcementData());
  await assertSucceeds(updateDoc(doc(userDb("adminA"), "announcements/existingA"), { title: "Updated" }));
});

test("32 disabled publisher 不能 create update announcement", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", false));
  await seed("announcements/existingA", announcementData());
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/newA"), announcementData()));
  await assertFails(updateDoc(doc(database, "announcements/existingA"), { title: "Updated" }));
});

test("33 disabled systemAdmin 不能 create update announcement", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", false));
  await seed("announcements/existingA", announcementData());
  const database = userDb("adminA");
  await assertFails(setDoc(doc(database, "announcements/newA"), announcementData()));
  await assertFails(updateDoc(doc(database, "announcements/existingA"), { title: "Updated" }));
});

test("34 非法 role 不能 create update announcement", async () => {
  await seed("authorizedPublishers/userA", profile("owner", true));
  await seed("announcements/existingA", announcementData());
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/newA"), announcementData()));
  await assertFails(updateDoc(doc(database, "announcements/existingA"), { title: "Updated" }));
});

test("35 authorization 文件不存在不能 create update announcement", async () => {
  await seed("announcements/existingA", announcementData());
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/newA"), announcementData()));
  await assertFails(updateDoc(doc(database, "announcements/existingA"), { title: "Updated" }));
});

test("36 announcement delete 維持禁止", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/existingA", announcementData());
  await assertFails(deleteDoc(doc(userDb("adminA"), "announcements/existingA")));
});

test("37 未定義 collection 維持 default deny", async () => {
  await seed("privateData/secretA", { secret: true });
  const database = userDb("adminA");
  await assertFails(getDoc(doc(database, "privateData/secretA")));
  await assertFails(setDoc(doc(database, "privateData/secretB"), { secret: true }));
});

test("publisher 只能更新自己 UID 的公告，同單位不同 UID 也不可", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", announcementData("Own", "userA"));
  await seed("announcements/other", announcementData("Other", "userB"));
  await assertSucceeds(updateDoc(doc(userDb("userA"), "announcements/own"), { title: "Updated" }));
  await assertFails(updateDoc(doc(userDb("userA"), "announcements/other"), { title: "Blocked" }));
});

test("systemAdmin 可以更新任一發布者公告", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/other", announcementData("Other", "userB"));
  await assertSucceeds(updateDoc(doc(userDb("adminA"), "announcements/other"), { title: "Admin updated" }));
});

test("browser client 不得竄改作者或生命週期欄位", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", announcementData("Own", "userA"));
  const reference = doc(userDb("userA"), "announcements/own");
  await assertFails(updateDoc(reference, { publisherUid: "userB" }));
  await assertFails(updateDoc(reference, { publicationStatus: "withdrawn" }));
  await assertFails(updateDoc(reference, { collectionStatus: "chasing" }));
});

test("38 enabled systemAdmin 可以 list publisherRequests", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertSucceeds(getDocs(collection(userDb("adminA"), "publisherRequests")));
});

test("39 publisher 不能 list publisherRequests", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("publisherRequests/userB", { email: "user-b@example.test", status: "pending" });
  await assertFails(getDocs(collection(userDb("userA"), "publisherRequests")));
});

test("40 disabled systemAdmin 不能 list publisherRequests", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", false));
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertFails(getDocs(collection(userDb("adminA"), "publisherRequests")));
});

test("41 未登入者不能 list publisherRequests", async () => {
  await seed("publisherRequests/userA", { email: VERIFIED_EMAIL, status: "pending" });
  await assertFails(getDocs(collection(anonymousDb(), "publisherRequests")));
});

test("42 announcement create 接受最多兩份合法 PDF metadata", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await assertSucceeds(setDoc(doc(userDb("userA"), "announcements/newA"), {
    ...announcementData(),
    attachments: [pdfAttachment("pdf-1"), pdfAttachment("pdf-2")],
  }));
});

test("43 announcement create 拒絕第三份 PDF", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await assertFails(setDoc(doc(userDb("userA"), "announcements/newA"), {
    ...announcementData(),
    attachments: [pdfAttachment("pdf-1"), pdfAttachment("pdf-2"), pdfAttachment("pdf-3")],
  }));
});

test("44 舊 image attachment schema 維持接受", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await assertSucceeds(setDoc(doc(userDb("userA"), "announcements/newA"), {
    ...announcementData(),
    attachments: [{ id: "image-1", type: "image", url: "https://example.test/image.webp", name: "舊圖片", caption: "說明" }],
  }));
});

test("45 PDF metadata 的路徑與 publisher UID 必須正確", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await assertFails(setDoc(doc(userDb("userA"), "announcements/newA"), {
    ...announcementData(),
    attachments: [{ ...pdfAttachment("pdf-1"), storagePath: "announcements/other/pdf/userB/pdf-1.pdf" }],
  }));
});

test("hasRelatedFollowUp 只能由 server 維護，client create 不得偽造", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await assertFails(setDoc(doc(userDb("userA"), "announcements/forgedByOwner"), { ...announcementData(), hasRelatedFollowUp: true }));
  await assertFails(setDoc(doc(userDb("adminA"), "announcements/forgedByAdmin"), { ...announcementData("Admin", "adminA"), hasRelatedFollowUp: true }));
  await assertSucceeds(setDoc(doc(userDb("userA"), "announcements/normal"), announcementData()));
});

test("latestFollowUp summary 只能由 server 維護，client 不能偽造或改寫", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/forgedLatest"), {
    ...announcementData(), latestFollowUp: { type: "supplement", createdAt: serverTimestamp() },
  }));
  await seed("announcements/latest", { ...announcementData("Latest", "userA"), latestFollowUp: { type: "reminder", createdAt: Timestamp.now() } });
  await assertFails(updateDoc(doc(database, "announcements/latest"), { latestFollowUp: { type: "supplement", createdAt: serverTimestamp() } }));
  await assertSucceeds(updateDoc(doc(database, "announcements/latest"), { title: "正文修正仍可儲存" }));
});

test("Gate 2 summary 與公告修正 count 只能依合法流程維護", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  const counts = { supplement: 0, reminder: 0, related: 0 };
  await assertFails(setDoc(doc(database, "announcements/forgedCount"), { ...announcementData(), contentUpdateCount: 1 }));
  await assertFails(setDoc(doc(database, "announcements/forgedFollowCounts"), { ...announcementData(), followUpCounts: counts }));
  await seed("announcements/count", { ...announcementData("原標題", "userA"), followUpCounts: counts });
  const reference = doc(database, "announcements/count");
  await assertSucceeds(updateDoc(reference, { title: "第一次修正", contentUpdatedAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", contentUpdateCount: 1 }));
  await assertSucceeds(updateDoc(reference, { title: "第二次修正", contentUpdatedAt: "2026-10-06T01:00:00.000Z", updatedAt: "2026-10-06T01:00:00.000Z", contentUpdateCount: 2 }));
  await assertFails(updateDoc(reference, { title: "跳號", contentUpdatedAt: "2026-10-06T02:00:00.000Z", updatedAt: "2026-10-06T02:00:00.000Z", contentUpdateCount: 5 }));
  await assertFails(updateDoc(reference, { contentUpdateCount: 3 }));
  await assertFails(updateDoc(reference, { contentUpdatedAt: "2026-10-06T03:00:00.000Z", updatedAt: "2026-10-06T03:00:00.000Z", contentUpdateCount: 3 }));
  await assertFails(updateDoc(reference, { followUpCounts: { supplement: 1, reminder: 0, related: 0 } }));
  await assertFails(updateDoc(reference, { followUpCounts: deleteField() }));
  await assertFails(updateDoc(reference, { title: "偽造摘要", followUpCounts: { supplement: 0, reminder: 1, related: 0 } }));
});

test("owner、其他 publisher 與 systemAdmin client 都不能修改 related summary", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", { ...profile("publisher", true), defaultDepartment: "教務處" });
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/summary", { ...announcementData(), hasRelatedFollowUp: true });
  await assertFails(updateDoc(doc(userDb("userA"), "announcements/summary"), { hasRelatedFollowUp: false }));
  await assertFails(updateDoc(doc(userDb("userB"), "announcements/summary"), { hasRelatedFollowUp: false }));
  await assertFails(updateDoc(doc(userDb("adminA"), "announcements/summary"), { hasRelatedFollowUp: false }));
  await assertFails(updateDoc(doc(userDb("userA"), "announcements/summary"), { hasRelatedFollowUp: deleteField() }));
  await assertSucceeds(updateDoc(doc(userDb("userA"), "announcements/summary"), { title: "正常修改" }));
});

test("46 announcement contact optional 且合法精簡結構可建立", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  await assertSucceeds(setDoc(doc(database, "announcements/noContact"), announcementData()));
  await assertSucceeds(setDoc(doc(database, "announcements/withContact"), { ...announcementData(), contact: { department: "設備組", extension: "104" } }));
});

test("47 announcement contact 拒絕非法分機與多餘敏感欄位", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/badExtension"), { ...announcementData(), contact: { department: "設備組", extension: "09-1234" } }));
  await assertFails(setDoc(doc(database, "announcements/extraField"), { ...announcementData(), contact: { department: "設備組", extension: "104", email: "private@example.test" } }));
});

test("47a LINE 通知等級與實際辦理對象可建立，舊公告缺少欄位仍相容", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  await assertSucceeds(setDoc(doc(database, "announcements/legacyNoLine"), announcementData()));
  for (const level of ["schoolwide", "required", "task", "general"]) {
    await assertSucceeds(setDoc(doc(database, `announcements/line-${level}`), { ...announcementData(), lineNotificationLevel: level }));
  }
  await assertSucceeds(setDoc(doc(database, "announcements/withNote"), { ...announcementData(), lineNotificationLevel: "task", audienceNote: "尚未完成雙因子驗證設定的同仁" }));
});

test("47b LINE 通知設定拒絕非法等級與過長或空白的實際辦理對象", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/badLevel"), { ...announcementData(), lineNotificationLevel: "urgent" }));
  await assertFails(setDoc(doc(database, "announcements/emptyNote"), { ...announcementData(), audienceNote: "" }));
  await assertFails(setDoc(doc(database, "announcements/longNote"), { ...announcementData(), audienceNote: "對".repeat(41) }));
  await assertFails(setDoc(doc(database, "announcements/numberNote"), { ...announcementData(), audienceNote: 123 }));
});

test("47c 只修改 LINE 通知設定不需更新原文次數，非法值仍拒絕", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/lineEdit", announcementData());
  const reference = doc(userDb("userA"), "announcements/lineEdit");
  await assertSucceeds(updateDoc(reference, { lineNotificationLevel: "required", audienceNote: "各班導師" }));
  await assertSucceeds(updateDoc(reference, { audienceNote: deleteField() }));
  await assertFails(updateDoc(reference, { lineNotificationLevel: "urgent" }));
  await assertFails(updateDoc(reference, { audienceNote: "對".repeat(41) }));
});

test("47d 最重發布：5 張圖片＋2 份 PDF＋聯絡資訊＋LINE 設定同時建立必須成功", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const images = Array.from({ length: 5 }, (_, index) => ({ id: `image-${index + 1}`, type: "image", url: `https://example.test/image-${index + 1}.webp`, name: `圖片${index + 1}.webp`, caption: "說明" }));
  await assertSucceeds(setDoc(doc(userDb("userA"), "announcements/newA"), {
    ...announcementData(),
    contact: { department: "設備組", extension: "104" },
    lineNotificationLevel: "schoolwide",
    audienceNote: "尚未完成雙因子驗證設定的同仁",
    attachments: [...images, pdfAttachment("pdf-1"), pdfAttachment("pdf-2")],
  }));
});

test("47e 實際辦理對象剛好 40 個中文字必須成功", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const note = "對".repeat(40);
  assert.equal(note.length, 40);
  await assertSucceeds(setDoc(doc(userDb("userA"), "announcements/note40"), { ...announcementData(), lineNotificationLevel: "task", audienceNote: note }));
  await seed("announcements/note40Edit", announcementData());
  await assertSucceeds(updateDoc(doc(userDb("userA"), "announcements/note40Edit"), { audienceNote: note }));
});

test("47f 附件驗證最佳化後仍拒絕不合法附件", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  const image = n => ({ id: `image-${n}`, type: "image", url: `https://example.test/image-${n}.webp`, name: `圖片${n}.webp` });
  const create = attachments => setDoc(doc(database, "announcements/newA"), { ...announcementData(), attachments });
  // 類型與格式
  await assertFails(create(["not-a-map"]));
  await assertFails(create([{ ...image(1), type: "video" }]));
  await assertFails(create([{ ...image(1), url: "http://example.test/image.webp" }]));
  await assertFails(create([{ ...image(1), name: "" }]));
  // PDF 欄位、大小、格式與路徑
  await assertFails(create([{ ...pdfAttachment("pdf-1"), contentType: "image/png" }]));
  await assertFails(create([{ ...pdfAttachment("pdf-1"), sizeBytes: 5 * 1024 * 1024 + 1 }]));
  await assertFails(create([{ ...pdfAttachment("pdf-1"), extra: "x" }]));
  await assertFails(create([(({ contentType: _contentType, ...item }) => item)(pdfAttachment("pdf-1"))]));
  await assertFails(create([(({ name: _name, ...item }) => ({ ...item, note: "x" }))(pdfAttachment("pdf-1"))]));
  await assertFails(create([{ ...pdfAttachment("pdf-1"), type: "image" }].map(({ url: _url, ...item }) => item)));
  await assertFails(create([pdfAttachment("pdf-1", "userB")]));
  // 順序與數量
  await assertFails(create([pdfAttachment("pdf-1"), image(1), image(2)]));
  await assertFails(create([image(1), image(2), image(3), image(4), pdfAttachment("pdf-1"), image(5), pdfAttachment("pdf-2")]));
  await assertFails(create([image(1), image(2), image(3), image(4), image(5), pdfAttachment("pdf-1"), pdfAttachment("pdf-2"), image(6)]));
  await assertFails(create([image(1), image(2), image(3), image(4), image(5), { ...pdfAttachment("pdf-1"), storagePath: "announcements/other/pdf/userA/pdf-1.pdf" }, pdfAttachment("pdf-2")]));
  // 合法最大組合仍可建立
  await assertSucceeds(create([image(1), image(2), image(3), image(4), image(5), pdfAttachment("pdf-1"), pdfAttachment("pdf-2")]));
});

test("47g 修改公告時附件驗證最佳化仍拒絕竄改", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const image = n => ({ id: `image-${n}`, type: "image", url: `https://example.test/image-${n}.webp`, name: `圖片${n}.webp` });
  await seed("announcements/newA", { ...announcementData(), attachments: [image(1), image(2), image(3), image(4), pdfAttachment("pdf-1"), pdfAttachment("pdf-2")] });
  const reference = doc(userDb("userA"), "announcements/newA");
  await assertFails(updateDoc(reference, { attachments: [pdfAttachment("pdf-1"), image(1), image(2), image(3), image(4), pdfAttachment("pdf-2")] }));
  await assertFails(updateDoc(reference, { attachments: [image(1), image(2), image(3), image(4), pdfAttachment("pdf-1"), { ...pdfAttachment("pdf-2"), sizeBytes: 0 }] }));
  await assertSucceeds(updateDoc(reference, { title: "附件未變更的一般修改", lineNotificationLevel: "required", audienceNote: "各班導師" }));
  // 缺少 publisherUid 的歷史公告：PDF 路徑無法組成，仍須拒絕 PDF；只有圖片時維持原本可修改。
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  const { publisherUid: _publisherUid, ...legacy } = announcementData();
  await seed("announcements/newA", legacy);
  const adminReference = doc(userDb("adminA"), "announcements/newA");
  await assertFails(updateDoc(adminReference, { attachments: [image(1), { ...pdfAttachment("pdf-1"), storagePath: "pdf-1.pdf" }] }));
  await assertFails(updateDoc(adminReference, { attachments: [image(1), pdfAttachment("pdf-1")] }));
  await assertSucceeds(updateDoc(adminReference, { attachments: [image(1), image(2)] }));
});

test("47h imageAudiences 合法對照表可建立與修改，舊公告沒有欄位仍相容", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  await assertSucceeds(setDoc(doc(database, "announcements/noTags"), announcementData()));
  await assertSucceeds(setDoc(doc(database, "announcements/tagged"), { ...announcementData(), imageAudiences: { "image-1": ["七年級導師"], "image-2": ["八年級導師", "九年級導師"] } }));
  await assertSucceeds(setDoc(doc(database, "announcements/fiveTags"), { ...announcementData(), imageAudiences: Object.fromEntries([1, 2, 3, 4, 5].map(n => [`image-${n}`, ["七年級導師"]])) }));
  await seed("announcements/editTags", announcementData());
  const reference = doc(database, "announcements/editTags");
  await assertSucceeds(updateDoc(reference, { imageAudiences: { "image-1": ["專任教師"] } }));
  await assertSucceeds(updateDoc(reference, { imageAudiences: deleteField() }));
});

test("47i imageAudiences 拒絕非對照表與超過 5 筆", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/listTags"), { ...announcementData(), imageAudiences: ["七年級導師"] }));
  await assertFails(setDoc(doc(database, "announcements/stringTags"), { ...announcementData(), imageAudiences: "七年級導師" }));
  await assertFails(setDoc(doc(database, "announcements/sixTags"), { ...announcementData(), imageAudiences: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`image-${n}`, ["七年級導師"]])) }));
  await seed("announcements/editBad", announcementData());
  const reference = doc(database, "announcements/editBad");
  await assertFails(updateDoc(reference, { imageAudiences: "七年級導師" }));
  await assertFails(updateDoc(reference, { imageAudiences: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`image-${n}`, ["七年級導師"]])) }));
});

test("47j 最重發布加強版：5 張皆有身分標記的圖片＋2 份 PDF＋聯絡＋通知等級＋實際辦理對象必須成功", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const images = Array.from({ length: 5 }, (_, index) => ({ id: `image-${index + 1}`, type: "image", url: `https://example.test/image-${index + 1}.webp`, name: `圖片${index + 1}.webp`, caption: "說明" }));
  await assertSucceeds(setDoc(doc(userDb("userA"), "announcements/newA"), {
    ...announcementData(),
    audiences: ["全校教師"],
    contact: { department: "設備組", extension: "104" },
    lineNotificationLevel: "schoolwide",
    audienceNote: "尚未完成雙因子驗證設定的同仁",
    imageAudiences: { "image-1": ["七年級導師"], "image-2": ["八年級導師"], "image-3": ["九年級導師"], "image-4": ["專任教師", "行政"], "image-5": ["七年級導師", "八年級導師", "九年級導師"] },
    attachments: [...images, pdfAttachment("pdf-1"), pdfAttachment("pdf-2")],
  }));
});

// ===== Wave 4：LINE 通知待辦 =====
const noticeBase = (type, publisherUid = "userA", createdBy = publisherUid) => ({ type, publisherUid, status: "pending", createdBy, createdAt: serverTimestamp() });
const heavyAnnouncement = () => ({
  ...announcementData(),
  audiences: ["全校教師"],
  contact: { department: "設備組", extension: "104" },
  lineNotificationLevel: "schoolwide",
  audienceNote: "尚未完成雙因子驗證設定的同仁",
  imageAudiences: { "image-1": ["七年級導師"], "image-2": ["八年級導師"], "image-3": ["九年級導師"], "image-4": ["專任教師", "行政"], "image-5": ["七年級導師", "八年級導師", "九年級導師"] },
  attachments: [...Array.from({ length: 5 }, (_, index) => ({ id: `image-${index + 1}`, type: "image", url: `https://example.test/image-${index + 1}.webp`, name: `圖片${index + 1}.webp`, caption: "說明" })), pdfAttachment("pdf-1"), pdfAttachment("pdf-2")],
});

test("L1 首次發布：最大附件公告與 publish 待辦同批寫入必須成功（運算上限關卡）", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  const database = userDb("userA");
  const batch = writeBatch(database);
  batch.set(doc(database, "announcements/newA"), heavyAnnouncement());
  batch.set(doc(database, "announcements/newA/lineNotices/publish"), noticeBase("publish"));
  await assertSucceeds(batch.commit());
});

test("L1b systemAdmin 最大附件公告與 publish 待辦同批寫入必須成功", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  const database = userDb("adminA");
  const announcement = { ...heavyAnnouncement(), publisherUid: "adminA", attachments: [...heavyAnnouncement().attachments.slice(0, 5), pdfAttachment("pdf-1", "adminA"), pdfAttachment("pdf-2", "adminA")] };
  const batch = writeBatch(database);
  batch.set(doc(database, "announcements/newA"), announcement);
  batch.set(doc(database, "announcements/newA/lineNotices/publish"), noticeBase("publish", "adminA"));
  await assertSucceeds(batch.commit());
});

test("L2 publish 待辦只能與新公告同批建立，舊公告不可補建且欄位必須正確", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/old", announcementData());
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/old/lineNotices/publish"), noticeBase("publish")));
  for (const [label, notice, id] of [
    ["狀態 sent", { ...noticeBase("publish"), status: "sent" }, "publish"],
    ["多餘欄位", { ...noticeBase("publish"), text: "x" }, "publish"],
    ["錯誤發布者", noticeBase("publish", "userB"), "publish"],
    ["錯誤 ID", noticeBase("publish"), "publish-2"],
  ]) {
    const batch = writeBatch(database);
    batch.set(doc(database, `announcements/n-${id}-${label.length}`), announcementData());
    batch.set(doc(database, `announcements/n-${id}-${label.length}/lineNotices/${id}`), notice);
    await assertFails(batch.commit(), label);
  }
});

test("L3 重要異動：只有同批增加修正次數時可建立 update 待辦，重複建立被拒", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/upd", { ...announcementData(), contentUpdateCount: 1 });
  const database = userDb("userA");
  const notice = (n, text = "期限延後至 11/30") => ({ ...noticeBase("update"), sourceId: n, text });
  const edit = n => ({ title: `修正 ${n}`, contentUpdatedAt: `2026-10-2${n}T00:00:00.000Z`, updatedAt: `2026-10-2${n}T00:00:00.000Z`, contentUpdateCount: n });
  await assertFails(setDoc(doc(database, "announcements/upd/lineNotices/update-1"), notice(1)), "未修改時不可補建");
  let batch = writeBatch(database);
  batch.update(doc(database, "announcements/upd"), edit(2));
  batch.set(doc(database, "announcements/upd/lineNotices/update-3"), notice(3));
  await assertFails(batch.commit(), "ID 與修正次數不符");
  batch = writeBatch(database);
  batch.update(doc(database, "announcements/upd"), edit(2));
  batch.set(doc(database, "announcements/upd/lineNotices/update-2"), notice(2, ""));
  await assertFails(batch.commit(), "空白文字");
  batch = writeBatch(database);
  batch.update(doc(database, "announcements/upd"), edit(2));
  batch.set(doc(database, "announcements/upd/lineNotices/update-2"), notice(2));
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(database, "announcements/upd/lineNotices/update-2"), notice(2)), "重複建立");
});

test("L4 補充與提醒：同批建立對應待辦；類型不符、其他單位相關補充不可建立", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", { ...profile("publisher", true), defaultDepartment: "教務處" });
  await seed("announcements/own", { ...announcementData("Own", "userA"), latestFollowUp: { type: "supplement", createdAt: Timestamp.fromMillis(1000) } });
  const database = userDb("userA");
  for (const type of ["supplement", "reminder"]) {
    const batch = writeBatch(database);
    batch.set(doc(database, `announcements/own/followUps/fu-${type}`), followUpData({ type }));
    batch.set(doc(database, `announcements/own/lineNotices/followup-fu-${type}`), { ...noticeBase(type), sourceId: `fu-${type}`, text: "請於 11/30 前完成" });
    await assertSucceeds(batch.commit(), type);
  }
  let batch = writeBatch(database);
  batch.set(doc(database, "announcements/own/followUps/fu-mismatch"), followUpData({ type: "supplement" }));
  batch.set(doc(database, "announcements/own/lineNotices/followup-fu-mismatch"), { ...noticeBase("reminder"), sourceId: "fu-mismatch", text: "x" });
  await assertFails(batch.commit(), "類型不符");
  await assertFails(setDoc(doc(database, "announcements/own/lineNotices/followup-fu-supplement"), { ...noticeBase("supplement"), sourceId: "fu-supplement", text: "x" }), "既有補充不可補建或重複建立");
  const other = userDb("userB");
  batch = writeBatch(other);
  batch.set(doc(other, "announcements/own/followUps/fu-related"), followUpData({ type: "related", authorUid: "userB", department: "教務處" }));
  batch.set(doc(other, "announcements/own/lineNotices/followup-fu-related"), { ...noticeBase("supplement", "userA", "userB"), sourceId: "fu-related", text: "x" });
  await assertFails(batch.commit(), "其他單位相關補充");
});

test("L5 讀取：原發布者與 systemAdmin 可讀，其他發布者與未登入者不可讀；跨公告查詢須限縮", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", profile("publisher", true));
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/r", announcementData());
  await seed("announcements/r/lineNotices/publish", { ...noticeBase("publish"), createdAt: Timestamp.now() });
  await assertSucceeds(getDoc(doc(userDb("userA"), "announcements/r/lineNotices/publish")));
  await assertSucceeds(getDoc(doc(userDb("adminA"), "announcements/r/lineNotices/publish")));
  await assertFails(getDoc(doc(userDb("userB"), "announcements/r/lineNotices/publish")));
  await assertFails(getDoc(doc(anonymousDb(), "announcements/r/lineNotices/publish")));
  await assertSucceeds(getDocs(query(collectionGroup(userDb("userA"), "lineNotices"), where("publisherUid", "==", "userA"), where("status", "==", "pending"))));
  await assertFails(getDocs(query(collectionGroup(userDb("userB"), "lineNotices"), where("status", "==", "pending"))));
  await assertSucceeds(getDocs(query(collectionGroup(userDb("adminA"), "lineNotices"), where("status", "==", "pending"))));
});

test("L6 確認已發送：只能 pending→sent 一次，不可改回、不可刪除；其他發布者不可確認", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", profile("publisher", true));
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/c", announcementData());
  await seed("announcements/c/lineNotices/publish", { ...noticeBase("publish"), createdAt: Timestamp.now() });
  await seed("announcements/c/lineNotices/update-1", { ...noticeBase("update"), sourceId: 1, text: "x", createdAt: Timestamp.now() });
  const sent = uid => ({ status: "sent", sentBy: uid, sentAt: serverTimestamp() });
  const owner = doc(userDb("userA"), "announcements/c/lineNotices/publish");
  await assertFails(updateDoc(doc(userDb("userB"), "announcements/c/lineNotices/publish"), sent("userB")), "其他發布者");
  await assertFails(updateDoc(owner, sent("userB")), "冒名確認");
  await assertFails(updateDoc(owner, { ...sent("userA"), text: "竄改" }), "同時修改其他欄位");
  await assertSucceeds(updateDoc(owner, sent("userA")));
  await assertFails(updateDoc(owner, sent("userA")), "重複確認");
  await assertFails(updateDoc(owner, { status: "pending" }), "改回待發送");
  await assertFails(deleteDoc(owner), "刪除");
  await assertSucceeds(updateDoc(doc(userDb("adminA"), "announcements/c/lineNotices/update-1"), sent("adminA")), "systemAdmin 代為確認");
});

test("L7 催繳：只有催繳中且對應本次開始時間的 chase 待辦可建立，重複建立被拒", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", profile("publisher", true));
  const startedAt = Timestamp.fromMillis(1761184800000);
  await seed("announcements/ch", { ...announcementData(), collectionStatus: "chasing", collectionMessage: "請儘速繳交", collectionStartedAt: startedAt });
  await seed("announcements/idle", announcementData());
  const database = userDb("userA");
  const chase = sourceId => ({ ...noticeBase("chase"), sourceId });
  await assertFails(setDoc(doc(database, "announcements/ch/lineNotices/chase-1"), chase(startedAt)), "ID 不符");
  await assertFails(setDoc(doc(database, `announcements/ch/lineNotices/chase-${Timestamp.fromMillis(1).toMillis()}`), chase(Timestamp.fromMillis(1))), "開始時間不符");
  await assertFails(setDoc(doc(database, "announcements/idle/lineNotices/chase-1761184800000"), chase(startedAt)), "未催繳");
  await assertFails(setDoc(doc(userDb("userB"), "announcements/ch/lineNotices/chase-1761184800000"), { ...chase(startedAt), createdBy: "userB" }), "其他發布者");
  await assertSucceeds(setDoc(doc(database, "announcements/ch/lineNotices/chase-1761184800000"), chase(startedAt)));
  await assertFails(setDoc(doc(database, "announcements/ch/lineNotices/chase-1761184800000"), chase(startedAt)), "重複建立");
});

test("L8 永久刪除中：公告不可修改、不可新增補充或催繳待辦，前端也不能自行加上或移除刪除標記", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/adminA", { ...profile("systemAdmin", true), defaultDepartment: "教務處" });
  const startedAt = Timestamp.fromMillis(1761184800000);
  const marker = { deletionStartedAt: Timestamp.fromMillis(1761184900000), deletionStartedBy: "adminA" };
  await seed("announcements/del", { ...announcementData(), publicationStatus: "withdrawn", collectionStatus: "chasing", collectionMessage: "請儘速繳交", collectionStartedAt: startedAt, ...marker });
  await seed("announcements/live", announcementData());
  const database = userDb("userA");
  await assertFails(updateDoc(doc(database, "announcements/del"), { title: "Updated" }), "刪除中修改");
  await assertFails(updateDoc(doc(userDb("adminA"), "announcements/del"), { title: "Updated" }), "刪除中管理員修改");
  await assertFails(setDoc(doc(database, "announcements/del/followUps/s"), followUpData()), "刪除中補充");
  await assertFails(setDoc(doc(userDb("adminA"), "announcements/del/followUps/a"), followUpData({ authorUid: "adminA", department: "教務處" })), "刪除中管理員補充");
  await assertFails(setDoc(doc(database, "announcements/del/lineNotices/chase-1761184800000"), { ...noticeBase("chase"), sourceId: startedAt }), "刪除中催繳待辦");
  await assertFails(updateDoc(doc(database, "announcements/live"), marker), "前端加上刪除標記");
  await assertSucceeds(updateDoc(doc(database, "announcements/live"), { title: "Updated" }));
  await assertSucceeds(setDoc(doc(database, "announcements/live/followUps/s"), followUpData()));
});

test("L9 公告不存在時：不可新增任何 followUps，也不可建立修正、補充、提醒、催繳 LINE 待辦", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", profile("publisher", true));
  await seed("authorizedPublishers/adminA", { ...profile("systemAdmin", true), defaultDepartment: "教務處" });
  const startedAt = Timestamp.fromMillis(1761184800000);
  const database = userDb("userA");
  const text = "LINE 通知內容";
  await assertFails(setDoc(doc(database, "announcements/gone/followUps/s"), followUpData()), "補充");
  await assertFails(setDoc(doc(database, "announcements/gone/followUps/r"), followUpData({ type: "reminder" })), "提醒");
  await assertFails(setDoc(doc(userDb("userB"), "announcements/gone/followUps/x"), followUpData({ type: "related", authorUid: "userB" })), "相關補充");
  await assertFails(setDoc(doc(userDb("adminA"), "announcements/gone/followUps/a"), followUpData({ authorUid: "adminA", department: "教務處" })), "管理員補充");
  await assertFails(setDoc(doc(database, "announcements/gone/lineNotices/update-1"), { ...noticeBase("update"), sourceId: 1, text }), "修正待辦");
  await assertFails(setDoc(doc(database, "announcements/gone/lineNotices/followup-s"), { ...noticeBase("supplement"), sourceId: "s", text }), "補充待辦");
  await assertFails(setDoc(doc(database, "announcements/gone/lineNotices/followup-r"), { ...noticeBase("reminder"), sourceId: "r", text }), "提醒待辦");
  await assertFails(setDoc(doc(database, "announcements/gone/lineNotices/chase-1761184800000"), { ...noticeBase("chase"), sourceId: startedAt }), "催繳待辦");
  await assertFails(setDoc(doc(userDb("adminA"), "announcements/gone/lineNotices/chase-1761184800000"), { ...noticeBase("chase", "userA", "adminA"), sourceId: startedAt }), "管理員催繳待辦");
  // 補充與其待辦同批送出也不行（模擬刪除後才到達的批次寫入）。
  const batch = writeBatch(database);
  batch.set(doc(database, "announcements/gone/followUps/s2"), followUpData());
  batch.set(doc(database, "announcements/gone/lineNotices/followup-s2"), { ...noticeBase("supplement"), sourceId: "s2", text });
  await assertFails(batch.commit(), "補充＋待辦批次");
  // 對照組：同樣的資料寫到存在的公告可成功，證明上面的拒絕來自公告不存在。
  await seed("announcements/live", announcementData());
  const control = writeBatch(database);
  control.set(doc(database, "announcements/live/followUps/s2"), followUpData());
  control.set(doc(database, "announcements/live/lineNotices/followup-s2"), { ...noticeBase("supplement"), sourceId: "s2", text });
  await assertSucceeds(control.commit(), "對照：補充＋待辦");
  await assertSucceeds(setDoc(doc(userDb("userB"), "announcements/live/followUps/x"), followUpData({ type: "related", authorUid: "userB" })), "對照：相關補充");
});

test("48 原 publisher 可新增 supplement 與 reminder", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", { ...announcementData("Own", "userA"), latestFollowUp: { type: "supplement", createdAt: Timestamp.fromMillis(1000) } });
  const database = userDb("userA");
  await assertSucceeds(setDoc(doc(database, "announcements/own/followUps/supplement"), followUpData()));
  await assertSucceeds(setDoc(doc(database, "announcements/own/followUps/reminder"), followUpData({ type: "reminder" })));
});

test("49 enabled systemAdmin 可新增別人公告的 supplement", async () => {
  await seed("authorizedPublishers/adminA", { ...profile("systemAdmin", true), defaultDepartment: "教務處" });
  await seed("announcements/other", announcementData("Other", "userB"));
  await assertSucceeds(setDoc(doc(userDb("adminA"), "announcements/other/followUps/admin"), followUpData({ authorUid: "adminA", department: "教務處" })));
});

test("50 其他 publisher 不可新增 supplement reminder，disabled publisher 不可新增", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", profile("publisher", false));
  await seed("announcements/other", announcementData("Other", "owner"));
  await assertFails(setDoc(doc(userDb("userA"), "announcements/other/followUps/a"), followUpData()));
  await assertFails(setDoc(doc(userDb("userB"), "announcements/other/followUps/b"), followUpData({ authorUid: "userB" })));
});

test("51 follow-up 作者、單位、類型與建立時間不可偽造", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", announcementData("Own", "userA"));
  const database = userDb("userA");
  const path = suffix => doc(database, `announcements/own/followUps/${suffix}`);
  await assertFails(setDoc(path("author"), followUpData({ authorUid: "userB" })));
  await assertFails(setDoc(path("department"), followUpData({ department: "教務處" })));
  await assertFails(setDoc(path("type"), followUpData({ type: "related" })));
  await assertFails(setDoc(path("time"), followUpData({ createdAt: Timestamp.fromMillis(0) })));
  await assertFails(setDoc(path("extra"), followUpData({ authorEmail: "private@example.test" })));
});

test("52 follow-up 僅允許 create，公開可讀但 client 不可 update delete", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", announcementData("Own", "userA"));
  await seed("announcements/own/followUps/one", { type: "supplement", message: "內容", authorUid: "userA", department: "設備組", createdAt: Timestamp.now() });
  await assertSucceeds(getDoc(doc(anonymousDb(), "announcements/own/followUps/one")));
  const reference = doc(userDb("userA"), "announcements/own/followUps/one");
  await assertFails(updateDoc(reference, { message: "修改" }));
  await assertFails(deleteDoc(reference));
});

test("53 legacy followUps array 維持唯讀且不能從 announcement update 改寫", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", { ...announcementData("Own", "userA"), followUps: [] });
  await assertFails(updateDoc(doc(userDb("userA"), "announcements/own"), {
    followUps: [{ type: "supplement", message: "不得寫回舊陣列", createdAt: "2026-09-22T10:00:00.000Z" }],
  }));
});

test("54 B publisher 可對 A 公告新增 related，owner A 不使用 related", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", { ...profile("publisher", true), defaultDepartment: "教務處" });
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/ownedByA", announcementData("A", "userA"));
  await assertSucceeds(setDoc(doc(userDb("userB"), "announcements/ownedByA/followUps/related"), followUpData({ type: "related", authorUid: "userB", department: "教務處" })));
  await assertSucceeds(setDoc(doc(userDb("adminA"), "announcements/ownedByA/followUps/admin-related"), followUpData({ type: "related", authorUid: "adminA" })));
  await assertFails(setDoc(doc(userDb("userA"), "announcements/ownedByA/followUps/owner-related"), followUpData({ type: "related" })));
});

test("55 related 拒絕 disabled、無 profile 與偽造作者單位時間", async () => {
  await seed("authorizedPublishers/userB", { ...profile("publisher", true), defaultDepartment: "教務處" });
  await seed("authorizedPublishers/disabled", profile("publisher", false));
  await seed("announcements/ownedByA", announcementData("A", "userA"));
  const path = suffix => doc(userDb("userB"), `announcements/ownedByA/followUps/${suffix}`);
  await assertFails(setDoc(path("author"), followUpData({ type: "related", authorUid: "userC", department: "教務處" })));
  await assertFails(setDoc(path("department"), followUpData({ type: "related", authorUid: "userB", department: "設備組" })));
  await assertFails(setDoc(path("time"), followUpData({ type: "related", authorUid: "userB", department: "教務處", createdAt: Timestamp.fromMillis(0) })));
  await assertFails(setDoc(doc(userDb("disabled"), "announcements/ownedByA/followUps/disabled"), followUpData({ type: "related", authorUid: "disabled" })));
  await assertFails(setDoc(doc(userDb("missing"), "announcements/ownedByA/followUps/missing"), followUpData({ type: "related", authorUid: "missing" })));
});

test("56 B 只能修改自己 related 的 message 與 server updatedAt", async () => {
  await seed("authorizedPublishers/userB", { ...profile("publisher", true), defaultDepartment: "教務處" });
  await seed("authorizedPublishers/userC", profile("publisher", true));
  await seed("announcements/ownedByA", announcementData("A", "userA"));
  const createdAt = Timestamp.fromMillis(1000);
  await seed("announcements/ownedByA/followUps/byB", { type: "related", message: "B", authorUid: "userB", department: "教務處", createdAt });
  await seed("announcements/ownedByA/followUps/byC", { type: "related", message: "C", authorUid: "userC", department: "設備組", createdAt });
  await seed("announcements/ownedByA/followUps/supplement", { type: "supplement", message: "A", authorUid: "userA", department: "設備組", createdAt });
  const own = doc(userDb("userB"), "announcements/ownedByA/followUps/byB");
  await assertSucceeds(updateDoc(own, { message: "B revised", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(own, { department: "設備組", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userDb("userB"), "announcements/ownedByA/followUps/byC"), { message: "spoof", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userDb("userB"), "announcements/ownedByA/followUps/supplement"), { message: "edit", updatedAt: serverTimestamp() }));
});

test("57 related 只能由作者刪除，原公告作者不可刪，systemAdmin 可管理", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("authorizedPublishers/userB", { ...profile("publisher", true), defaultDepartment: "教務處" });
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/ownedByA", announcementData("A", "userA"));
  const record = { type: "related", message: "B", authorUid: "userB", department: "教務處", createdAt: Timestamp.fromMillis(1000) };
  await seed("announcements/ownedByA/followUps/deleteByB", record);
  await seed("announcements/ownedByA/followUps/notByA", record);
  await seed("announcements/ownedByA/followUps/admin", record);
  await assertSucceeds(deleteDoc(doc(userDb("userB"), "announcements/ownedByA/followUps/deleteByB")));
  await assertFails(deleteDoc(doc(userDb("userA"), "announcements/ownedByA/followUps/notByA")));
  await assertSucceeds(updateDoc(doc(userDb("adminA"), "announcements/ownedByA/followUps/admin"), { message: "admin edit", updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(userDb("adminA"), "announcements/ownedByA/followUps/admin")));
});

test("58 related 權限不放寬原 Announcement update", async () => {
  await seed("authorizedPublishers/userB", profile("publisher", true));
  await seed("announcements/ownedByA", announcementData("A", "userA"));
  await assertFails(updateDoc(doc(userDb("userB"), "announcements/ownedByA"), { title: "B cannot edit A" }));
});

test("59 Gate 4 原作者可撤回 active 與 legacy 無 status 的 supplement/reminder", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", announcementData("Own", "userA"));
  const original = (type, status) => ({ type, message: type, authorUid: "userA", department: "設備組", createdAt: Timestamp.fromMillis(1000), ...(status ? { status } : {}) });
  await seed("announcements/own/followUps/activeSupplement", original("supplement", "active"));
  await seed("announcements/own/followUps/activeReminder", original("reminder", "active"));
  await seed("announcements/own/followUps/legacySupplement", original("supplement"));
  await seed("announcements/own/followUps/legacyReminder", original("reminder"));
  const database = userDb("userA");
  for (const id of ["activeSupplement", "activeReminder", "legacySupplement", "legacyReminder"]) {
    await assertSucceeds(updateDoc(doc(database, `announcements/own/followUps/${id}`), {
      status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "userA",
    }));
  }
});

test("60 Gate 4 systemAdmin 可撤回、非作者與 disabled publisher 不可撤回", async () => {
  await seed("authorizedPublishers/author", profile("publisher", true));
  await seed("authorizedPublishers/other", profile("publisher", true));
  await seed("authorizedPublishers/disabled", profile("publisher", false));
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await seed("announcements/own", announcementData("Own", "author"));
  const record = { type: "supplement", message: "內容", authorUid: "author", department: "設備組", status: "active", createdAt: Timestamp.fromMillis(1000) };
  await seed("announcements/own/followUps/admin", record);
  await seed("announcements/own/followUps/other", record);
  await seed("announcements/own/followUps/disabled", record);
  const withdrawal = uid => ({ status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: uid });
  await assertSucceeds(updateDoc(doc(userDb("adminA"), "announcements/own/followUps/admin"), withdrawal("adminA")));
  await assertFails(updateDoc(doc(userDb("other"), "announcements/own/followUps/other"), withdrawal("other")));
  await assertFails(updateDoc(doc(userDb("disabled"), "announcements/own/followUps/disabled"), withdrawal("disabled")));
});

test("61 Gate 4 撤回拒絕偽造 metadata、混入欄位、重複撤回與 related 撤回", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", announcementData("Own", "userA"));
  const original = { type: "supplement", message: "內容", authorUid: "userA", department: "設備組", status: "active", createdAt: Timestamp.fromMillis(1000) };
  for (const id of ["badTime", "badBy", "mixed", "repeat", "related"]) await seed(`announcements/own/followUps/${id}`, id === "related" ? { ...original, type: "related" } : original);
  const database = userDb("userA");
  await assertFails(updateDoc(doc(database, "announcements/own/followUps/badTime"), { status: "withdrawn", withdrawnAt: Timestamp.fromMillis(0), withdrawnBy: "userA" }));
  await assertFails(updateDoc(doc(database, "announcements/own/followUps/badBy"), { status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "other" }));
  await assertFails(updateDoc(doc(database, "announcements/own/followUps/mixed"), { status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "userA", message: "偷改原文" }));
  await assertSucceeds(updateDoc(doc(database, "announcements/own/followUps/repeat"), { status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "userA" }));
  await assertFails(updateDoc(doc(database, "announcements/own/followUps/repeat"), { status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "userA" }));
  await assertFails(updateDoc(doc(database, "announcements/own/followUps/related"), { status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "userA" }));
});

test("62 Gate 4 create 必為 active 且不可帶 withdrawn metadata，撤回不需 client 寫 parent summary", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", { ...announcementData("Own", "userA"), latestFollowUp: { type: "supplement", createdAt: Timestamp.fromMillis(1000) } });
  const database = userDb("userA");
  await assertFails(setDoc(doc(database, "announcements/own/followUps/withdrawnCreate"), followUpData({ status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "userA" })));
  await assertFails(setDoc(doc(database, "announcements/own/followUps/metadataCreate"), followUpData({ withdrawnAt: serverTimestamp(), withdrawnBy: "userA" })));
  await seed("announcements/own/followUps/active", { type: "reminder", message: "提醒", authorUid: "userA", department: "設備組", status: "active", createdAt: Timestamp.fromMillis(1000) });
  await assertSucceeds(updateDoc(doc(database, "announcements/own/followUps/active"), { status: "withdrawn", withdrawnAt: serverTimestamp(), withdrawnBy: "userA" }));
  await assertFails(updateDoc(doc(database, "announcements/own"), { followUpCounts: { supplement: 0, reminder: 0, related: 0 } }));
  await assertFails(updateDoc(doc(database, "announcements/own"), { latestFollowUp: deleteField() }));
  await assertFails(updateDoc(doc(database, "announcements/own"), { hasRelatedFollowUp: true }));
});
