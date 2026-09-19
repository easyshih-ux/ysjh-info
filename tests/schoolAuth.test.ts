import test from "node:test";
import assert from "node:assert/strict";
import { getEmailDomain, isExpectedSchoolEmail } from "../lib/schoolAuth.ts";

test("辨識 apps.ntpc.edu.tw 學校帳號",()=>{assert.equal(isExpectedSchoolEmail("teacher@apps.ntpc.edu.tw"),true);assert.equal(getEmailDomain("teacher@apps.ntpc.edu.tw"),"apps.ntpc.edu.tw")});
test("辨識 ysjh.ntpc.edu.tw 學校帳號",()=>{assert.equal(isExpectedSchoolEmail("staff@ysjh.ntpc.edu.tw"),true);assert.equal(getEmailDomain("staff@ysjh.ntpc.edu.tw"),"ysjh.ntpc.edu.tw")});
test("一般 Gmail 不辨識為學校帳號",()=>{assert.equal(isExpectedSchoolEmail("teacher@gmail.com"),false)});
test("相似但錯誤的網域不得通過",()=>{for(const email of ["teacher@apps.ntpc.edu.tw.example.com","teacher@fakeapps.ntpc.edu.tw","teacher@ysjh.ntpc.edu.tw.evil.test"])assert.equal(isExpectedSchoolEmail(email),false)});
