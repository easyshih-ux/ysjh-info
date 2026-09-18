import test from "node:test";
import assert from "node:assert/strict";
import { mockAnnouncements } from "../data/mockAnnouncements.ts";
import { addAnnouncementFollowUp, filterManagedAnnouncements, updateAnnouncement, validateAnnouncementCore } from "../lib/announcementManagement.ts";

test("設備組只篩出設備組 Mock 公告",()=>{const items=filterManagedAnnouncements(mockAnnouncements,"設備組");assert.ok(items.length>0);assert.ok(items.every(item=>item.department==="設備組"))});
test("可搜尋設備組既有公告標題與內容",()=>{assert.equal(filterManagedAnnouncements(mockAnnouncements,"設備組","晨讀")[0].id,"ann-001");assert.equal(filterManagedAnnouncements(mockAnnouncements,"設備組","圖書館")[0].id,"ann-001")});
test("編輯公告後 id 不變、不產生重複公告並產生 updatedAt",()=>{const original=mockAnnouncements[0];const edited={...original,title:"修正標題"};const result=updateAnnouncement(mockAnnouncements,edited,"2026-09-19T10:32:00+08:00");assert.equal(result.length,mockAnnouncements.length);assert.equal(result[0].id,original.id);assert.equal(result[0].updatedAt,"2026-09-19T10:32:00+08:00")});
test("可補登 importantEvent",()=>{const item=structuredClone(mockAnnouncements[0]);item.importantEvents.push({date:"2026-09-26",title:"補登事項"});assert.equal(item.importantEvents.at(-1)?.title,"補登事項")});
test("可補登網址",()=>{const item=structuredClone(mockAnnouncements[0]);item.links.push({id:"new",label:"補登網址",url:"https://example.com",type:"website",isPrimary:false});assert.equal(item.links.at(-1)?.label,"補登網址")});
test("可補登圖片",()=>{const item=structuredClone(mockAnnouncements[0]);item.attachments.push({id:"new",type:"image",name:"補登圖片",caption:"",url:"blob:test"});assert.equal(item.attachments.at(-1)?.type,"image")});
test("可補登並修正多筆 deadlines",()=>{const item=structuredClone(mockAnnouncements[0]);item.deadlines.push({date:"2026-09-30",label:"補登期限"});item.deadlines[0]={...item.deadlines[0],date:"2026-09-29"};assert.equal(item.deadlines.at(-1)?.label,"補登期限");assert.equal(item.deadlines[0].date,"2026-09-29")});
test("可新增 supplement 並保留歷史",()=>{const before=mockAnnouncements[0].followUps.length;const result=addAnnouncementFollowUp(mockAnnouncements,"ann-001",{createdAt:"2026-09-19T10:00:00+08:00",type:"supplement",message:"補充內容"});assert.equal(result[0].followUps.length,before+1);assert.equal(result[0].followUps.at(-1)?.type,"supplement")});
test("可新增 reminder 並保留歷史",()=>{const before=mockAnnouncements[0].followUps.length;const result=addAnnouncementFollowUp(mockAnnouncements,"ann-001",{createdAt:"2026-09-19T11:00:00+08:00",type:"reminder",message:"稽催內容"});assert.equal(result[0].followUps.length,before+1);assert.equal(result[0].followUps.at(-1)?.type,"reminder")});
test("新增與編輯共用核心資料驗證",()=>{assert.deepEqual(validateAnnouncementCore(mockAnnouncements[0]),{});const invalid={...mockAnnouncements[0],title:""};assert.equal(validateAnnouncementCore(invalid).title,"請輸入公告標題")});
