import test from "node:test";
import assert from "node:assert/strict";
import { mockAnnouncements, DEMO_NOW } from "../data/mockAnnouncements.ts";
import { ACADEMIC_YEAR_STORAGE_KEY, announcementsForIdentity, daysUntil, deadlineDateLabel, deadlineRelativeLabel, deadlineUrgency, importantEventDateLabel, isForIdentity, localDate, needsAcademicYearConfirmation, readSavedIdentity, ROLE_STORAGE_KEY, saveIdentity, upcomingDeadlines, filterAnnouncements, weeklyEvents } from "../lib/announcementLogic.ts";
import { announcementsForAcademicYear, CURRENT_ACADEMIC_YEAR, FRONTEND_ACADEMIC_YEARS, isFrontendAcademicYear } from "../lib/academicYear.ts";
test("本週日期只包含週一至週日",()=>{const events=weeklyEvents(mockAnnouncements,DEMO_NOW);assert.ok(events.every(e=>e.date>="2026-09-14"&&e.date<="2026-09-20"));assert.ok(!events.some(e=>e.date==="2026-09-21"))});
test("同一天多事項不互相覆蓋，且依時間排序",()=>{const items=weeklyEvents(mockAnnouncements,DEMO_NOW).filter(e=>e.date==="2026-09-18");assert.equal(items.length,2);assert.deepEqual(items.map(e=>e.time),["07:52","10:30"])});
test("deadlines 由近至遠排序並排除已截止",()=>{const items=upcomingDeadlines(mockAnnouncements,DEMO_NOW);assert.deepEqual(items.map(i=>`${i.deadline.date}-${i.deadline.time||""}`),[...items].map(i=>`${i.deadline.date}-${i.deadline.time||""}`).sort());assert.ok(!items.some(i=>i.announcement.id==="ann-007"))});
test("適用對象篩選支援複選資料",()=>{const results=filterAnnouncements(mockAnnouncements,"","七年級導師","全部");assert.ok(results.length>=3);assert.ok(results.every(a=>a.audiences.includes("七年級導師")))});
test("關鍵字搜尋標題、內容與發布單位",()=>{assert.equal(filterAnnouncements(mockAnnouncements,"防災","全部","全部")[0].id,"ann-003");assert.ok(filterAnnouncements(mockAnnouncements,"總務處","全部","全部").some(a=>a.id==="ann-005"));assert.ok(filterAnnouncements(mockAnnouncements,"心理師","全部","全部").some(a=>a.id==="ann-004"))});
test("已截止公告仍可透過搜尋找到",()=>{assert.equal(filterAnnouncements(mockAnnouncements,"教師節","全部","全部")[0].id,"ann-007")});
test("附件 mock data 涵蓋無圖片、單張與多張",()=>{assert.ok(mockAnnouncements.some(a=>a.attachments.length===0));assert.ok(mockAnnouncements.some(a=>a.attachments.length===1));assert.ok(mockAnnouncements.some(a=>a.attachments.length>1))});
test("稽催 mock data 涵蓋無稽催、一次與多次",()=>{const withDeadline=mockAnnouncements.filter(a=>a.deadlines.length);assert.ok(withDeadline.some(a=>a.followUps.length===0));assert.ok(withDeadline.some(a=>a.followUps.length===1));assert.ok(withDeadline.some(a=>a.followUps.length>1))});
test("完整複合公告同時包含所有資料區塊",()=>{const item=mockAnnouncements.find(a=>a.id==="ann-001")!;assert.ok(item.content.length>100);assert.ok(item.importantEvents.length>0);assert.ok(item.deadlines.length>0);assert.ok(item.attachments.length>0);assert.ok(item.followUps.length>0)});
test("Mock Data 涵蓋0、1、2、3筆 deadlines",()=>{for(const count of [0,1,2,3])assert.ok(mockAnnouncements.some(a=>a.deadlines.length===count))});
test("同一公告多筆期限皆進入即將截止並連回原公告",()=>{const items=upcomingDeadlines(mockAnnouncements,DEMO_NOW).filter(i=>i.announcement.id==="ann-001");assert.equal(items.length,2);assert.ok(items.every(i=>i.announcement===mockAnnouncements[0]))});
test("importantEvents 與 deadlines 彼此獨立",()=>{const onlyEvent={...mockAnnouncements[0],importantEvents:[{date:"2026-09-18",title:"活動"}],deadlines:[]};assert.equal(upcomingDeadlines([onlyEvent],DEMO_NOW).length,0);const onlyDeadline={...mockAnnouncements[0],importantEvents:[],deadlines:[{date:"2026-09-18",time:"16:00",label:"繳回"}]};assert.equal(weeklyEvents([onlyDeadline],DEMO_NOW).length,0);assert.equal(upcomingDeadlines([onlyDeadline],DEMO_NOW).length,1)});
test("importantEvents 與 deadlines 可同時存在且分別進入正確區塊",()=>{const item=mockAnnouncements.find(a=>a.id==="ann-002")!;assert.ok(weeklyEvents([item],DEMO_NOW).length>0);assert.ok(upcomingDeadlines([item],DEMO_NOW).length===3)});
test("稽催時間可由新至舊排序",()=>{const item=mockAnnouncements.find(a=>a.followUps.length>1)!;const sorted=[...item.followUps].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));assert.equal(sorted[0].createdAt,"2026-09-18T09:30:00+08:00")});

const memoryStorage=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}};
test("首次無 localStorage 身分時回傳 null",()=>{assert.equal(readSavedIdentity(memoryStorage(),CURRENT_ACADEMIC_YEAR),null)});
test("選擇七年級導師後保存身分與學年度",()=>{const storage=memoryStorage();saveIdentity(storage,"七年級導師",115);assert.equal(storage.getItem(ROLE_STORAGE_KEY),"七年級導師");assert.equal(storage.getItem(ACADEMIC_YEAR_STORAGE_KEY),"115")});
test("再次進入同一學年度時沿用已保存身分",()=>{const storage=memoryStorage();saveIdentity(storage,"七年級導師",115);assert.equal(readSavedIdentity(storage,115),"七年級導師")});
test("七年級導師只取得七導或全校教師公告",()=>{const results=announcementsForIdentity(mockAnnouncements,"七年級導師");assert.ok(results.length<mockAnnouncements.length);assert.ok(results.every(a=>a.audiences.includes("七年級導師")||a.audiences.includes("全校教師")))});
test("多身分公告會供各對應身分查看",()=>{const item=mockAnnouncements.find(a=>a.id==="ann-004")!;assert.ok(isForIdentity(item,"七年級導師"));assert.ok(isForIdentity(item,"八年級導師"));assert.ok(isForIdentity(item,"九年級導師"))});
test("全校教師公告涵蓋所有現有教師身分",()=>{const item={...mockAnnouncements[0],audiences:["全校教師"] as const};for(const identity of ["七年級導師","八年級導師","九年級導師","專任教師","行政"] as const)assert.ok(isForIdentity(item,identity))});
test("切換身分後篩選結果立即不同",()=>{const seven=announcementsForIdentity(mockAnnouncements,"七年級導師").map(a=>a.id);const admin=announcementsForIdentity(mockAnnouncements,"行政").map(a=>a.id);assert.notDeepEqual(seven,admin)});
test("查看全部公告時不套用身分篩選",()=>{assert.equal([...mockAnnouncements].length,mockAnnouncements.length);assert.ok(mockAnnouncements.length>announcementsForIdentity(mockAnnouncements,"七年級導師").length)});
test("返回與我相關可再次套用原身分",()=>{const storage=memoryStorage();saveIdentity(storage,"七年級導師",115);const restored=readSavedIdentity(storage,115)!;assert.deepEqual(announcementsForIdentity(mockAnnouncements,restored as "七年級導師").map(a=>a.id),announcementsForIdentity(mockAnnouncements,"七年級導師").map(a=>a.id))});

test("115學年度預設只顯示115公告",()=>{const items=announcementsForAcademicYear(mockAnnouncements,CURRENT_ACADEMIC_YEAR);assert.ok(items.length>0);assert.ok(items.every(a=>a.academicYear===115))});
test("可主動切換查看114公告",()=>{const items=announcementsForAcademicYear(mockAnnouncements,FRONTEND_ACADEMIC_YEARS[1]);assert.ok(items.length>0);assert.ok(items.every(a=>a.academicYear===114))});
test("113及更早公告不在一般前台學年度清單",()=>{assert.equal(isFrontendAcademicYear(113),false);assert.deepEqual([...FRONTEND_ACADEMIC_YEARS],[115,114])});
test("上一學年度 deadline 不進入目前即將截止",()=>{const current=announcementsForAcademicYear(mockAnnouncements,115);assert.ok(!upcomingDeadlines(current,DEMO_NOW).some(i=>i.announcement.academicYear===114))});
test("上一學年度 importantEvents 不進入目前本週事項",()=>{const current=announcementsForAcademicYear(mockAnnouncements,115);assert.ok(!weeklyEvents(current,DEMO_NOW).some(i=>i.announcement.academicYear===114))});
test("selectedAcademicYear 與目前同為115時沿用身分",()=>{const storage=memoryStorage();saveIdentity(storage,"七年級導師",115);assert.equal(readSavedIdentity(storage,115),"七年級導師");assert.equal(needsAcademicYearConfirmation(storage,115),false)});
test("目前學年度改為116時要求重新確認",()=>{const storage=memoryStorage();saveIdentity(storage,"七年級導師",115);assert.equal(readSavedIdentity(storage,116),null);assert.equal(needsAcademicYearConfirmation(storage,116),true)});
test("重新選擇後 selectedAcademicYear 更新為116",()=>{const storage=memoryStorage();saveIdentity(storage,"七年級導師",115);saveIdentity(storage,"八年級導師",116);assert.equal(storage.getItem(ACADEMIC_YEAR_STORAGE_KEY),"116");assert.equal(readSavedIdentity(storage,116),"八年級導師")});
test("同一學年度可隨時切換身分",()=>{const storage=memoryStorage();saveIdentity(storage,"七年級導師",115);saveIdentity(storage,"行政",115);assert.equal(readSavedIdentity(storage,115),"行政")});
test("連結資料涵蓋零個、單一與多個網址",()=>{assert.ok(mockAnnouncements.some(a=>a.links.length===0));assert.ok(mockAnnouncements.some(a=>a.links.length===1));assert.ok(mockAnnouncements.some(a=>a.links.length>1))});
test("具有 primary link 的公告可取得單一首頁操作",()=>{const items=mockAnnouncements.filter(a=>a.links.some(link=>link.isPrimary));assert.ok(items.length>0);for(const item of items)assert.equal(item.links.filter(link=>link.isPrimary).length,1)});
test("家長日公告包含重要事項、長文與指定導航 primary link",()=>{const item=mockAnnouncements.find(a=>a.id==="ann-008")!;assert.ok(item.importantEvents.length>0);assert.ok(item.content.length>100);const link=item.links.find(link=>link.isPrimary)!;assert.equal(link.label,"家長日班級導航地圖（手機版）");assert.equal(link.url,"https://easyshih-ux.github.io/parent-day-map/")});
test("所有公告均使用 links 陣列資料模型",()=>{assert.ok(mockAnnouncements.every(a=>Array.isArray(a.links)));assert.ok(mockAnnouncements.flatMap(a=>a.links).every(link=>link.id&&link.label&&link.url&&link.type==="website"))});

const reminderNow=new Date("2026-09-16T23:30:00+08:00");
const reminderAnnouncement={...mockAnnouncements[0],id:"reminder-test",audiences:["七年級導師"] as const,importantEvents:[
  {date:"2026-09-15",time:"09:00",title:"昨天事項"},
  {date:"2026-09-16",time:"08:00",title:"今天事項"},
  {date:"2026-09-17",time:"09:00",title:"明天事項"},
  {date:"2026-09-18",time:"10:00",title:"本週稍後事項"},
  {date:"2026-09-21",time:"11:00",title:"下週事項"},
],deadlines:[
  {date:"2026-09-15",time:"23:59",label:"昨天截止"},
  {date:"2026-09-16",time:"08:00",label:"今天早上已過但仍是今天"},
  {date:"2026-09-17",time:"12:00",label:"明天截止"},
  {date:"2026-09-20",time:"17:00",label:"稍後截止"},
]};
test("本週重要事項只顯示今天起至本週日",()=>{assert.deepEqual(weeklyEvents([reminderAnnouncement],reminderNow).map(item=>item.title),["今天事項","明天事項","本週稍後事項"])});
test("本週事項排除同週已過日期且不納入下週",()=>{const titles=weeklyEvents([reminderAnnouncement],reminderNow).map(item=>item.title);assert.ok(!titles.includes("昨天事項"));assert.ok(!titles.includes("下週事項"))});
test("重要事項日期顯示今天、明天與正式日期星期",()=>{assert.equal(importantEventDateLabel("2026-09-16",reminderNow),"今天");assert.equal(importantEventDateLabel("2026-09-17",reminderNow),"明天");assert.equal(importantEventDateLabel("2026-09-18",reminderNow),"9/18（五）")});
test("即將截止排除昨天但保留今天已過時間的期限",()=>{const labels=upcomingDeadlines([reminderAnnouncement],reminderNow).map(item=>item.deadline.label);assert.ok(!labels.includes("昨天截止"));assert.ok(labels.includes("今天早上已過但仍是今天"))});
test("期限相對文字為今天、明天與剩餘天數",()=>{assert.equal(deadlineRelativeLabel("2026-09-16",reminderNow),"今天截止");assert.equal(deadlineRelativeLabel("2026-09-17",reminderNow),"明天截止");assert.equal(deadlineRelativeLabel("2026-09-20",reminderNow),"剩 4 天")});
test("期限同時提供補零的正式日期",()=>{assert.equal(deadlineDateLabel("2026-09-16"),"09/16 截止");assert.equal(deadlineDateLabel("2027-01-03"),"01/03 截止")});
test("截止日依本地日期差距分成紅橘與一般提醒",()=>{assert.equal(deadlineUrgency("2026-09-17",reminderNow),"red");assert.equal(deadlineUrgency("2026-09-18",reminderNow),"red");assert.equal(deadlineUrgency("2026-09-19",reminderNow),"orange");assert.equal(deadlineUrgency("2026-09-21",reminderNow),"orange");assert.equal(deadlineUrgency("2026-09-22",reminderNow),"normal")});
test("日期計算以台灣本地日曆日為準，不受午夜與 UTC 位移影響",()=>{assert.equal(daysUntil("2026-09-16",reminderNow),0);assert.equal(daysUntil("2026-09-17",reminderNow),1);const parsed=localDate("2026-09-16");assert.deepEqual([parsed.getFullYear(),parsed.getMonth()+1,parsed.getDate()],[2026,9,16])});
test("首頁提醒仍先套用使用者身分篩選",()=>{const unrelated={...reminderAnnouncement,id:"unrelated",audiences:["行政"] as const,importantEvents:[{date:"2026-09-16",title:"行政限定事項"}],deadlines:[{date:"2026-09-16",label:"行政限定期限"}]};const related=announcementsForIdentity([reminderAnnouncement,unrelated],"七年級導師");assert.deepEqual(weeklyEvents(related,reminderNow).map(item=>item.announcement.id),["reminder-test","reminder-test","reminder-test"]);assert.ok(upcomingDeadlines(related,reminderNow).every(item=>item.announcement.id==="reminder-test"))});
test("提醒篩選不改動最新公告或完整公告中的歷史資料",()=>{const source=[reminderAnnouncement];weeklyEvents(source,reminderNow);upcomingDeadlines(source,reminderNow);assert.equal(source.length,1);assert.ok(source[0].importantEvents.some(item=>item.title==="昨天事項"));assert.ok(source[0].deadlines.some(item=>item.label==="昨天截止"))});
