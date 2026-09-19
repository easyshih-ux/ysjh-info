import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Firebase Storage 重用 shared Firebase App 與正式 bucket", () => {
  const storage = source("lib/firebaseStorageClient.ts");
  assert.match(storage, /getStorage\(getFirebaseApp\(\), FIREBASE_STORAGE_BUCKET\)/);
  assert.match(storage, /gs:\/\/ysjh-public-affairs\.firebasestorage\.app/);
  assert.doesNotMatch(storage, /initializeApp\(/);
});

test("Storage 上傳 contentType 固定為 image/webp", () => {
  const publishing = source("lib/announcementPublishing.ts");
  assert.match(publishing, /uploadBytes\(storageReference, blob, \{ contentType: "image\/webp" \}\)/);
});
