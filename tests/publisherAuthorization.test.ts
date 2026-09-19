import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PUBLISHER_REQUEST_STATUSES,
  PUBLISHER_ROLES,
  hasValidPublisherProfileCore,
  isPublisherRequestStatus,
  isPublisherRole,
} from "../lib/publisherAuthorization.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("發布者 schema 只接受 systemAdmin 與 publisher 角色", () => {
  assert.deepEqual(PUBLISHER_ROLES, ["systemAdmin", "publisher"]);
  assert.equal(isPublisherRole("systemAdmin"), true);
  assert.equal(isPublisherRole("publisher"), true);
  assert.equal(isPublisherRole("admin"), false);
});

test("待授權狀態固定為 pending、approved、rejected", () => {
  assert.deepEqual(PUBLISHER_REQUEST_STATUSES, ["pending", "approved", "rejected"]);
  assert.equal(isPublisherRequestStatus("pending"), true);
  assert.equal(isPublisherRequestStatus("enabled"), false);
});

test("PublisherProfile 核心欄位驗證角色、啟用狀態與正式發布單位", () => {
  assert.equal(hasValidPublisherProfileCore({
    email: "publisher@ysjh.ntpc.edu.tw",
    role: "publisher",
    enabled: true,
    defaultDepartment: "設備組",
  }), true);
  assert.equal(hasValidPublisherProfileCore({
    email: "admin@ysjh.ntpc.edu.tw",
    role: "systemAdmin",
    enabled: true,
    defaultDepartment: "不存在的單位" as "設備組",
  }), false);
});

test("announcements 只接受已登入、啟用且具有正式角色的 UID profile", () => {
  const rules = source("firestore.rules");
  const authorizationFunction = rules.match(/function isAuthorizedPublisher\(\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  const announcementMatch = rules.match(/match \/announcements\/\{announcementId\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";

  assert.match(authorizationFunction, /request\.auth != null/);
  assert.match(authorizationFunction, /authorizedPublishers\/\$\(request\.auth\.uid\)/);
  assert.match(authorizationFunction, /\.data\.enabled == true/);
  assert.match(authorizationFunction, /\.data\.role in \['systemAdmin', 'publisher'\]/);
  assert.match(announcementMatch, /allow create, update: if isAuthorizedPublisher\(\)/);
  assert.doesNotMatch(announcementMatch, /publisherRequests/);
  assert.match(announcementMatch, /allow delete: if false/);
});

test("publisher 與 systemAdmin 都不能從 browser 修改 authorizedPublishers", () => {
  const rules = source("firestore.rules");
  const profileMatch = rules.match(/match \/authorizedPublishers\/\{publisherUid\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";

  assert.match(profileMatch, /allow get: if request\.auth != null && request\.auth\.uid == publisherUid/);
  assert.match(profileMatch, /allow list, create, update, delete: if false/);
});

test("publisherRequest 只能由本人以已驗證且相符的 Auth email 建立", () => {
  const rules = source("firestore.rules");
  const ownershipFunction = rules.match(/function isOwnVerifiedPublisherRequest\(publisherUid\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  const requestMatch = rules.match(/match \/publisherRequests\/\{publisherUid\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";

  assert.match(ownershipFunction, /request\.auth != null/);
  assert.match(ownershipFunction, /request\.auth\.uid == publisherUid/);
  assert.match(ownershipFunction, /request\.auth\.token\.email_verified == true/);
  assert.match(ownershipFunction, /request\.auth\.token\.email is string/);
  assert.match(rules, /request\.resource\.data\.email == request\.auth\.token\.email/);
  assert.match(requestMatch, /allow create: if isOwnVerifiedPublisherRequest\(publisherUid\)/);
  assert.match(requestMatch, /allow list: if isEnabledSystemAdmin\(\)/);
  assert.match(requestMatch, /allow update, delete: if false/);
});

test("publisherRequest 僅允許既定欄位與 pending 狀態", () => {
  const rules = source("firestore.rules");
  const validationFunction = rules.match(/function isValidNewPublisherRequest\(\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";

  assert.match(validationFunction, /keys\(\)\.hasAll/);
  assert.match(validationFunction, /keys\(\)\.hasOnly/);
  assert.match(validationFunction, /'email'/);
  assert.match(validationFunction, /'displayName'/);
  assert.match(validationFunction, /'requestedAt'/);
  assert.match(validationFunction, /'lastSeenAt'/);
  assert.match(validationFunction, /'status'/);
  assert.doesNotMatch(validationFunction, /'role'/);
  assert.doesNotMatch(validationFunction, /'enabled'/);
  assert.doesNotMatch(validationFunction, /'approvedBy'/);
  assert.match(validationFunction, /status == 'pending'/);
  assert.match(validationFunction, /requestedAt == request\.time/);
  assert.match(validationFunction, /lastSeenAt == request\.time/);
});

test("Storage Rules 版本化且維持只允許授權發布者建立圖片", () => {
  const rules = source("storage.rules");
  const firebaseConfig = source("firebase.json");

  assert.match(firebaseConfig, /"storage"\s*:\s*\{\s*"rules"\s*:\s*"storage\.rules"/);
  assert.match(rules, /firestore\.exists\(/);
  assert.match(rules, /authorizedPublishers\/\$\(request\.auth\.uid\)/);
  assert.match(rules, /\.data\.enabled == true/);
  assert.match(rules, /request\.resource\.size <= 2 \* 1024 \* 1024/);
  assert.match(rules, /contentType\.matches\('image\/\.\*'\)/);
  assert.match(rules, /allow update, delete: if false/);
  assert.match(rules, /match \/\{allPaths=\*\*\}[\s\S]*allow read, write: if false/);
});
