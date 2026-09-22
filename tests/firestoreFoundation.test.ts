import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Firestore client 重用既有 Firebase App 且不建立第二套 initialization", () => {
  const firebaseClient = source("lib/firebaseClient.ts");
  const firestoreClient = source("lib/firestoreClient.ts");
  const combined = `${firebaseClient}\n${firestoreClient}`;

  assert.match(firebaseClient, /export function getFirebaseApp\(\)/);
  assert.match(firestoreClient, /import \{ getFirebaseApp \} from "\.\/firebaseClient\.ts"/);
  assert.match(firestoreClient, /getFirestore\(getFirebaseApp\(\)\)/);
  assert.equal(combined.match(/initializeApp\(/g)?.length, 1);
});

test("Firestore announcement document 沿用既有 Announcement model", () => {
  const firestoreClient = source("lib/firestoreClient.ts");
  const model = source("lib/announcements.ts");

  assert.match(firestoreClient, /Omit<Announcement, "id">/);
  assert.match(model, /deadlines: Deadline\[\]/);
  assert.doesNotMatch(model, /\bdeadline\s*:/);
  assert.doesNotMatch(model, /\bsubmissionLink\b/);
  assert.doesNotMatch(model, /\brelatedLink\b/);
});

test("Firestore rules 公開讀取公告但只允許 UID 授權文件啟用者寫入", () => {
  const rules = source("firestore.rules");

  assert.match(rules, /match \/announcements\/\{announcementId\}/);
  assert.match(rules, /allow read: if true;/);
  assert.match(rules, /allow create: if isAuthorizedPublisher\(\)/);
  assert.match(rules, /request\.resource\.data\.publisherUid == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.publicationStatus == 'published'/);
  assert.match(
    rules,
    /allow update: if canManageAnnouncement\(\)\s*&& keepsLifecycleFields\(\)\s*&& canUseAnnouncementDepartment\(\)\s*&& isValidContact\(request\.resource\.data\)\s*&& keepsValidAttachments\(announcementId\);/,
  );
  assert.match(rules, /function canUseAnnouncementDepartment\(\)/);
  assert.match(rules, /function isValidContact\(data\)/);
  assert.match(rules, /contact\.keys\(\)\.hasOnly\(\['department', 'extension'\]\)/);
  assert.match(rules, /resource\.data\.publisherUid == request\.auth\.uid/);
  assert.match(rules, /isEnabledSystemAdmin\(\)/);
  assert.match(rules, /affectedKeys\(\)\.hasAny/);
  assert.match(rules, /'publicationStatus'/);
  assert.match(rules, /'collectionStatus'/);
  assert.match(rules, /authorizedPublishers\/\$\(request\.auth\.uid\)/);
  assert.match(rules, /\.data\.enabled == true/);
  assert.match(rules, /\.data\.role in \['systemAdmin', 'publisher'\]/);
  assert.match(rules, /allow list, create, update, delete: if false;/);
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/);
});
