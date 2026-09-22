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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
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

test("28b publisher 只能使用固定單位或自己的自訂單位", async () => {
  await seed("authorizedPublishers/userA", { ...profile("publisher", true), defaultDepartment: "家長會" });
  const database = userDb("userA");
  await assertSucceeds(setDoc(doc(database, "announcements/customA"), { ...announcementData(), department: "家長會" }));
  await assertSucceeds(setDoc(doc(database, "announcements/fixedA"), { ...announcementData(), department: "人事室" }));
  await assertFails(setDoc(doc(database, "announcements/foreignA"), { ...announcementData(), department: "校友會" }));
});

test("29 enabled publisher 可以 update announcement", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/existingA", announcementData());
  await assertSucceeds(updateDoc(doc(userDb("userA"), "announcements/existingA"), { title: "Updated" }));
});

test("30 enabled systemAdmin 可以 create announcement", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await assertSucceeds(setDoc(doc(userDb("adminA"), "announcements/newA"), announcementData("Emulator announcement", "adminA")));
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

test("48 原 publisher 可新增 supplement 與 reminder", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/own", announcementData("Own", "userA"));
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
