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
    ...overrides,
  };
}

function announcementData(title = "Emulator announcement") {
  return { title, content: "Rules integration test only" };
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

test("29 enabled publisher 可以 update announcement", async () => {
  await seed("authorizedPublishers/userA", profile("publisher", true));
  await seed("announcements/existingA", announcementData());
  await assertSucceeds(updateDoc(doc(userDb("userA"), "announcements/existingA"), { title: "Updated" }));
});

test("30 enabled systemAdmin 可以 create announcement", async () => {
  await seed("authorizedPublishers/adminA", profile("systemAdmin", true));
  await assertSucceeds(setDoc(doc(userDb("adminA"), "announcements/newA"), announcementData()));
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
