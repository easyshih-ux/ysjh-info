import test from "node:test";
import assert from "node:assert/strict";
import {
  getAuthorizedPublisher,
  type AuthorizedPublisher,
} from "../lib/authorizedPublishers.ts";

const publishers: AuthorizedPublisher[] = [
  { email: "publisher@ysjh.ntpc.edu.tw", defaultDepartment: "教務處", enabled: true },
  { email: "disabled@apps.ntpc.edu.tw", defaultDepartment: "學務處", enabled: false },
];

test("authorized email 正常授權", () => {
  assert.equal(getAuthorizedPublisher("publisher@ysjh.ntpc.edu.tw", publishers)?.defaultDepartment, "教務處");
});

test("email 以 trim 與 lowercase 後精確比對", () => {
  assert.equal(getAuthorizedPublisher("  Publisher@YSJH.NTPC.EDU.TW  ", publishers)?.email, "publisher@ysjh.ntpc.edu.tw");
});

test("未列入名單不得授權", () => {
  assert.equal(getAuthorizedPublisher("unknown@gmail.com", publishers), null);
});

test("enabled false 不得授權", () => {
  assert.equal(getAuthorizedPublisher("disabled@apps.ntpc.edu.tw", publishers), null);
});

test("學校網域但未授權仍不得發布", () => {
  assert.equal(getAuthorizedPublisher("teacher@apps.ntpc.edu.tw", publishers), null);
  assert.equal(getAuthorizedPublisher("teacher@ysjh.ntpc.edu.tw", publishers), null);
});

test("defaultDepartment 必須是正式發布單位", () => {
  const invalid: AuthorizedPublisher[] = [
    { email: "invalid@ysjh.ntpc.edu.tw", defaultDepartment: "不存在的單位", enabled: true },
  ];
  assert.equal(getAuthorizedPublisher("invalid@ysjh.ntpc.edu.tw", invalid), null);
});
