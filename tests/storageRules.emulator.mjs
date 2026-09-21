import { after, afterEach, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const TEST_PROJECT_ID = "demo-ysjh-info-rules-test";
let testEnvironment;

before(async () => {
  const firestoreMatch = (process.env.FIRESTORE_EMULATOR_HOST ?? "").match(/^(127\.0\.0\.1|localhost):(\d+)$/);
  const storageMatch = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "").match(/^(127\.0\.0\.1|localhost):(\d+)$/);
  if (!firestoreMatch || !storageMatch) throw new Error("Storage Rules tests require local Firestore and Storage emulators.");
  testEnvironment = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    firestore: { host: firestoreMatch[1], port: Number(firestoreMatch[2]) },
    storage: {
      host: storageMatch[1],
      port: Number(storageMatch[2]),
      rules: await readFile(new URL("../storage.rules", import.meta.url), "utf8"),
    },
  });
});

afterEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.clearStorage();
});
after(async () => testEnvironment?.cleanup());

async function seedPublisher(uid, enabled = true) {
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `authorizedPublishers/${uid}`), { enabled, role: "publisher" });
  });
}

function storage(uid) {
  return testEnvironment.authenticatedContext(uid).storage();
}

function pdfUpload(uid, { size = 1024, contentType = "application/pdf", pathUid = uid } = {}) {
  return storage(uid).ref(`announcements/announcement-a/pdf/${pathUid}/pdf-a.pdf`).put(
    new Uint8Array(size),
    { contentType, customMetadata: { uploaderUid: uid } },
  );
}

test("PDF Storage Rules 接受 enabled publisher 的合法 PDF", async () => {
  await seedPublisher("userA");
  await assertSucceeds(pdfUpload("userA"));
});

test("PDF Storage Rules 拒絕非 PDF MIME", async () => {
  await seedPublisher("userA");
  await assertFails(pdfUpload("userA", { contentType: "application/zip" }));
});

test("PDF Storage Rules 拒絕超過 5 MB", async () => {
  await seedPublisher("userA");
  await assertFails(pdfUpload("userA", { size: 5 * 1024 * 1024 + 1 }));
});

test("PDF Storage Rules 拒絕 UID path 不符", async () => {
  await seedPublisher("userA");
  await assertFails(pdfUpload("userA", { pathUid: "userB" }));
});

test("PDF Storage Rules 拒絕未授權與 disabled 使用者", async () => {
  await assertFails(pdfUpload("userA"));
  await seedPublisher("userA", false);
  await assertFails(pdfUpload("userA"));
});
