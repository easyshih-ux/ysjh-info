"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Edit3, Eye, MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { AUDIENCES, formatImportantEventSchedule, toggleAudienceSelection, type Announcement, type Audience, type FollowUp } from "@/lib/announcements";
import { CURRENT_ACADEMIC_YEAR, FRONTEND_ACADEMIC_YEARS } from "@/lib/academicYear";
import { DEPARTMENTS, departmentGroups, isDepartment, isFixedDepartment, standaloneDepartments, type Department } from "@/lib/departments";
import { applyAnnouncementUpdate, filterManagedAnnouncements, MANAGE_DEPARTMENT_KEY, validateAnnouncementCore } from "@/lib/announcementManagement";
import { AnnouncementManagementError, appendManagedFollowUp, updateManagedAnnouncement } from "@/lib/announcementManagementFirestore";
import { readManagedAnnouncements } from "@/lib/announcementFirestore";
import { manageAnnouncementLifecycle, type AnnouncementLifecycleAction } from "@/lib/announcementLifecycle";
import { useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { setPrimaryLink } from "@/lib/publishDraft";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LineSummaryCard } from "@/components/line-summary-card";
import { announcementTimeStates } from "@/lib/announcementLogic";
import styles from "./manage.module.css";

const clone = (item: Announcement): Announcement => structuredClone(item);
const formatDateTime = (value: string) => new Date(value).toLocaleString("zh-TW");

export default function ManagePage() {
  const publisher = useAuthorizedPublisher();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [department, setDepartment] = useState<Department | "全部">("設備組");
  const [audience, setAudience] = useState<Audience | "全部">("全部");
  const [academicYear, setAcademicYear] = useState(CURRENT_ACADEMIC_YEAR);
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<Announcement | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [followTarget, setFollowTarget] = useState<Announcement | null>(null);
  const [followType, setFollowType] = useState<FollowUp["type"]>("supplement");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [managementScope, setManagementScope] = useState<"mine" | "all">(publisher.role === "systemAdmin" ? "all" : "mine");

  useEffect(() => {
    const saved = localStorage.getItem(MANAGE_DEPARTMENT_KEY);
    if (isDepartment(saved)) setDepartment(saved);
    let active = true;
    readManagedAnnouncements().then(value => { if (active) setItems(value); }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const changeDepartment = (value: Department | "全部") => {
    setDepartment(value);
    if (value === "全部") localStorage.removeItem(MANAGE_DEPARTMENT_KEY);
    else localStorage.setItem(MANAGE_DEPARTMENT_KEY, value);
  };
  const manageable = useMemo(() => managementScope === "all" && publisher.role === "systemAdmin" ? items : items.filter(item => item.publisherUid === publisher.uid), [items, managementScope, publisher.role, publisher.uid]);
  const visible = useMemo(() => filterManagedAnnouncements(manageable, department, query, audience, academicYear), [manageable, department, query, audience, academicYear]);

  const runLifecycleAction = async (item: Announcement, action: AnnouncementLifecycleAction) => {
    if (savingRef.current) return;
    if (action === "delete") {
      if (!window.confirm("永久刪除後無法復原。是否繼續？")) return;
      if (!window.confirm(`再次確認永久刪除「${item.title}」？`)) return;
    }
    const message = action === "startChase" ? (window.prompt("催繳提醒文字（選填）", item.collectionMessage || "") ?? null) : "";
    if (message === null) return;
    savingRef.current = true; setSaving(true); setError(""); setNotice("");
    try {
      await manageAnnouncementLifecycle(item.id, action, message);
      setItems(current => action === "delete" ? current.filter(value => value.id !== item.id) : current.map(value => value.id !== item.id ? value : action === "withdraw" ? { ...value, publicationStatus: "withdrawn" } : action === "restore" ? { ...value, publicationStatus: "published", withdrawnAt: undefined, withdrawnBy: undefined } : action === "startChase" ? { ...value, collectionStatus: "chasing", collectionMessage: message } : { ...value, collectionStatus: undefined, collectionMessage: undefined, collectionStartedAt: undefined, collectionStartedBy: undefined }));
      setNotice(action === "withdraw" ? "公告已下架" : action === "restore" ? "公告已復原" : action === "startChase" ? "催繳已啟動" : action === "stopChase" ? "催繳已結束" : "公告已永久刪除");
    } catch (caught) {
      console.error("announcement lifecycle action failed", caught);
      setError("公告操作失敗，請確認權限與網路連線後再試。資料尚未變更。");
    } finally { savingRef.current = false; setSaving(false); }
  };

  const saveEdit = async () => {
    if (!editing || savingRef.current) return;
    const validation = validateAnnouncementCore(editing);
    if (Object.keys(validation).length) { setError(Object.values(validation)[0] ?? "請確認公告資料是否完整。"); return; }
    savingRef.current = true; setSaving(true); setError("");
    try {
      const updatedAt = await updateManagedAnnouncement(editing);
      setItems(current => current.map(item => item.id === editing.id ? applyAnnouncementUpdate(item, editing, updatedAt) : item));
      setEditing(null); setNotice("公告已更新");
    } catch (caught) {
      setError(caught instanceof AnnouncementManagementError ? caught.message : "公告更新失敗，請稍後再試。");
    } finally { savingRef.current = false; setSaving(false); }
  };

  const addFollow = async () => {
    if (!followTarget || !message.trim() || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const followUp = await appendManagedFollowUp(followTarget.id, followType, message);
      setItems(current => current.map(item => item.id === followTarget.id ? { ...item, followUps: [...item.followUps, followUp], updatedAt: followUp.createdAt } : item));
      setFollowTarget(null); setMessage(""); setNotice(followType === "supplement" ? "補充已新增" : "提醒已新增");
    } catch (caught) {
      setError(caught instanceof AnnouncementManagementError ? caught.message : "補充／提醒新增失敗，請稍後再試。");
    } finally { savingRef.current = false; setSaving(false); }
  };

  return <main className={styles.page}>
    <header><div><Link href="/publish"><ArrowLeft />返回發布頁</Link><p>{CURRENT_ACADEMIC_YEAR} 學年度 · Firestore 正式資料</p><h1>已發布公告管理</h1><span>查看既有公告、修正內容，或新增補充／提醒。</span></div></header>
    <div className={styles.shell}>
      <section className={styles.controls}>
        {publisher.role === "systemAdmin" && <label>管理範圍<select value={managementScope} onChange={event => setManagementScope(event.target.value as "mine" | "all")}><option value="all">全校公告管理</option><option value="mine">我的公告</option></select></label>}
        <label>發布單位<select value={department} onChange={event => changeDepartment(event.target.value as Department | "全部")}><option value="全部">全部發布單位</option>{departmentGroups.map(group => <optgroup key={group.office} label={group.office}>{group.departments.map(value => <option key={value}>{value}</option>)}</optgroup>)}</select></label>
        <label>適用對象<select value={audience} onChange={event => setAudience(event.target.value as Audience | "全部")}><option value="全部">全部對象</option>{AUDIENCES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>學年度<select value={academicYear} onChange={event => setAcademicYear(Number(event.target.value))}>{FRONTEND_ACADEMIC_YEARS.map(value => <option key={value} value={value}>{value} 學年度</option>)}</select></label>
        <label className={styles.search}><Search /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋公告標題、內容或發布單位" /></label>
      </section>
      {notice && <p className={styles.notice} role="status">{notice}</p>}{error && !editing && !followTarget && <p className={styles.errorNotice} role="alert">{error}</p>}
      {loading ? <p className={styles.empty} aria-live="polite">公告載入中…</p> : loadError ? <p className={`${styles.empty} ${styles.errorNotice}`} role="alert">目前無法載入公告，請稍後再試。</p> : items.length === 0 ? <p className={styles.empty}>目前沒有已發布公告。</p> : <section className={styles.list} aria-label="公告列表">{visible.length === 0 ? <p className={styles.empty}>目前沒有符合的公告。</p> : visible.map(item => <article key={item.id}>
        <div className={styles.meta}><span>{item.academicYear} 學年度</span><span>{item.department}</span><span>{item.publicationStatus === "withdrawn" ? "已下架" : "正常發布"}</span><span>{announcementTimeStates(item, new Date()).deadline}</span>{announcementTimeStates(item, new Date()).activity !== "正常" && <span>{announcementTimeStates(item, new Date()).activity}</span>}{item.collectionStatus === "chasing" && <span>催繳中</span>}<span>發布者：{item.publisherDisplayName || item.publisherEmail || item.publisherUid || "舊公告（無 UID）"}</span><span>發布 {formatDateTime(item.publishedAt)}</span>{item.updatedAt && <span>更新 {formatDateTime(item.updatedAt)}</span>}</div>
        <h2>{item.title}</h2><p>{item.audiences.join("、") || "未設定適用對象"}</p>
        <div className={styles.flags}><span>{item.importantEvents.length ? `${item.importantEvents.length} 筆重要事項` : "無重要事項"}</span><span>{item.deadlines.length ? `${item.deadlines.length} 筆截止期限` : "無截止期限"}</span><span>{item.attachments.length ? `${item.attachments.length} 張圖片` : "無圖片"}</span><span>{item.followUps.length ? `${item.followUps.length} 筆補充／提醒` : "無補充／提醒"}</span></div>
        <div className={styles.cardActions}><Button variant="outline" onClick={() => setViewing(item)}><Eye />查看</Button><Button variant="outline" onClick={() => { setError(""); setEditing(clone(item)); }}><Edit3 />修正公告</Button><Button variant="outline" onClick={() => { setError(""); setMessage(""); setFollowTarget(item); }}><MessageSquarePlus />新增補充／提醒</Button>{item.publicationStatus === "withdrawn" ? <Button variant="outline" disabled={saving} onClick={() => runLifecycleAction(item, "restore")}>復原公告</Button> : <Button variant="outline" disabled={saving} onClick={() => runLifecycleAction(item, "withdraw")}>下架公告</Button>}{item.deadlines.length > 0 && (item.collectionStatus === "chasing" ? <Button variant="outline" disabled={saving} onClick={() => runLifecycleAction(item, "stopChase")}>結束催繳</Button> : <Button variant="outline" disabled={saving} onClick={() => runLifecycleAction(item, "startChase")}>啟動催繳</Button>)}{publisher.role === "systemAdmin" && <Button variant="outline" disabled={saving} onClick={() => runLifecycleAction(item, "delete")}><Trash2 />永久刪除</Button>}</div>
      </article>)}</section>}
    </div>

    <AnnouncementDetails item={viewing} onClose={() => setViewing(null)} />
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving) { setEditing(null); setError(""); } }}><DialogContent className={styles.editor} showCloseButton={!saving}>{editing && <>
      <DialogHeader><DialogDescription>修正既有公告 · 發布時間保持不變</DialogDescription><DialogTitle>{editing.title}</DialogTitle></DialogHeader>
      <div className={styles.twoFields}><label>學年度<select value={editing.academicYear} onChange={event => setEditing({ ...editing, academicYear: Number(event.target.value) })}>{FRONTEND_ACADEMIC_YEARS.map(value => <option key={value} value={value}>{value} 學年度</option>)}</select></label><label>發布單位<select value={editing.department} onChange={event => setEditing({ ...editing, department: event.target.value as Department })}>{standaloneDepartments.map(value => <option key={value}>{value}</option>)}{departmentGroups.map(group => <optgroup key={group.office} label={group.office}>{group.departments.map(value => <option key={value}>{value}</option>)}</optgroup>)}{!isFixedDepartment(editing.department) && <option value={editing.department}>{editing.department}</option>}</select></label></div>
      <label>公告標題<Input value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
      <fieldset><legend>適用對象</legend><div className={styles.audiences}>{AUDIENCES.map(value => <label key={value}><Checkbox checked={editing.audiences.includes(value)} onCheckedChange={checked => setEditing({ ...editing, audiences: toggleAudienceSelection(editing.audiences, value, checked === true) })} />{value}</label>)}</div></fieldset>
      <label>完整公告內容<Textarea value={editing.content} onChange={event => setEditing({ ...editing, content: event.target.value })} /></label>
      <EditorExtras item={editing} setItem={setEditing} /><ReadOnlyImages item={editing} />
      {error && <p className={styles.errorNotice} role="alert">{error}</p>}
      <div className={styles.editorActions}><Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>取消</Button><Button onClick={saveEdit} disabled={saving}>{saving ? "儲存中…" : "儲存修改"}</Button></div>
    </>}</DialogContent></Dialog>

    <Dialog open={!!followTarget} onOpenChange={open => { if (!open && !saving) { setFollowTarget(null); setError(""); } }}><DialogContent showCloseButton={!saving}><DialogHeader><DialogDescription>{followTarget?.title}</DialogDescription><DialogTitle>新增補充／提醒</DialogTitle></DialogHeader><label className={styles.dialogField}>類型<select value={followType} onChange={event => setFollowType(event.target.value as FollowUp["type"])}><option value="supplement">補充</option><option value="reminder">提醒</option></select></label><label className={styles.dialogField}>內容<Textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="輸入新增資訊；既有紀錄不會被覆蓋。" /></label>{error && <p className={styles.errorNotice} role="alert">{error}</p>}<Button disabled={!message.trim() || saving} onClick={addFollow}>{saving ? "儲存中…" : "新增紀錄"}</Button></DialogContent></Dialog>
  </main>;
}

function EditorExtras({ item, setItem }: { item: Announcement; setItem: (item: Announcement) => void }) {
  const updateEvent = (index: number, field: "date" | "time" | "endDate" | "endTime" | "title", value: string) => setItem({ ...item, importantEvents: item.importantEvents.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry) });
  const updateDeadline = (index: number, field: "date" | "time" | "label", value: string) => setItem({ ...item, deadlines: item.deadlines.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry) });
  return <div className={styles.extras}>
    <section><h3>重要日期／活動</h3>{item.importantEvents.map((entry, index) => <div className={styles.eventRow} key={index}><label>開始日期<Input type="date" value={entry.date} onChange={event => updateEvent(index, "date", event.target.value)} /></label><label>開始時間（選填）<Input type="time" value={entry.time ?? ""} onChange={event => updateEvent(index, "time", event.target.value)} />{entry.time && <button className={styles.clearTime} type="button" onClick={() => updateEvent(index, "time", "")}>清除時間</button>}</label><label>結束日期（選填）<Input type="date" min={entry.date || undefined} value={entry.endDate ?? ""} onChange={event => updateEvent(index, "endDate", event.target.value)} /></label><label>結束時間（選填）<Input type="time" value={entry.endTime ?? ""} onChange={event => updateEvent(index, "endTime", event.target.value)} />{entry.endTime && <button className={styles.clearTime} type="button" onClick={() => updateEvent(index, "endTime", "")}>清除時間</button>}</label><label>事項名稱<Input value={entry.title} onChange={event => updateEvent(index, "title", event.target.value)} /></label><Button aria-label="移除重要事項" variant="ghost" size="icon" onClick={() => setItem({ ...item, importantEvents: item.importantEvents.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></Button></div>)}<Button variant="outline" size="sm" onClick={() => setItem({ ...item, importantEvents: [...item.importantEvents, { date: "", title: "" }] })}>＋ 新增重要事項</Button></section>
    <section><h3>繳交／填報期限</h3>{item.deadlines.map((entry, index) => <div className={styles.row} key={index}><Input type="date" value={entry.date} onChange={event => updateDeadline(index, "date", event.target.value)} /><Input type="time" value={entry.time ?? ""} onChange={event => updateDeadline(index, "time", event.target.value)} /><Input value={entry.label} onChange={event => updateDeadline(index, "label", event.target.value)} /><Button aria-label="移除期限" variant="ghost" size="icon" onClick={() => setItem({ ...item, deadlines: item.deadlines.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></Button></div>)}<Button variant="outline" size="sm" onClick={() => setItem({ ...item, deadlines: [...item.deadlines, { date: "", label: "" }] })}>＋ 新增期限</Button></section>
    <section><h3>相關網址</h3>{item.links.map((link, index) => <div className={styles.linkRow} key={link.id}><Input value={link.label} onChange={event => setItem({ ...item, links: item.links.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry) })} placeholder="顯示名稱" /><Input type="url" value={link.url} onChange={event => setItem({ ...item, links: item.links.map((entry, entryIndex) => entryIndex === index ? { ...entry, url: event.target.value } : entry) })} placeholder="https://" /><label><Checkbox checked={link.isPrimary} onCheckedChange={checked => setItem({ ...item, links: setPrimaryLink(item.links, link.id, checked === true) })} />主要連結</label><Button aria-label="移除網址" variant="ghost" size="icon" onClick={() => setItem({ ...item, links: item.links.filter(entry => entry.id !== link.id) })}><Trash2 /></Button></div>)}<Button variant="outline" size="sm" onClick={() => setItem({ ...item, links: [...item.links, { id: crypto.randomUUID(), label: "", url: "", type: "website", isPrimary: false }] })}>＋ 新增網址</Button></section>
  </div>;
}

function AnnouncementDetails({ item, onClose }: { item: Announcement | null; onClose: () => void }) {
  const followUps = item ? [...item.followUps].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  return <Dialog open={!!item} onOpenChange={open => !open && onClose()}><DialogContent className={styles.details}>{item && <><DialogHeader><DialogDescription>{item.department} · {item.academicYear} 學年度</DialogDescription><DialogTitle>{item.title}</DialogTitle></DialogHeader><dl className={styles.timestamps}><div><dt>發布時間</dt><dd>{formatDateTime(item.publishedAt)}</dd></div><div><dt>更新時間</dt><dd>{item.updatedAt ? formatDateTime(item.updatedAt) : "尚未更新"}</dd></div><div><dt>適用對象</dt><dd>{item.audiences.join("、") || "未設定"}</dd></div></dl><section><h3>公告內容</h3><p className={styles.fullContent}>{item.content}</p></section><DetailList title="重要日期／活動" empty="無重要事項" values={item.importantEvents.map(entry => `${formatImportantEventSchedule(entry)}｜${entry.title}`)} /><DetailList title="繳交／填報期限" empty="無截止期限" values={item.deadlines.map(entry => `${entry.date}${entry.time ? ` ${entry.time}` : ""}｜${entry.label}`)} /><ReadOnlyImages item={item} /><section><h3>相關網址</h3>{item.links.length ? <ul>{item.links.map(link => <li key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}{link.isPrimary ? "（主要連結）" : ""}</a></li>)}</ul> : <p>無相關網址</p>}</section><section><h3>補充／提醒</h3>{followUps.length ? <div className={styles.followUps}>{followUps.map((followUp, index) => <article key={`${followUp.createdAt}-${index}`}><strong>{followUp.type === "supplement" ? "補充" : "提醒"}</strong><time>{formatDateTime(followUp.createdAt)}</time><p>{followUp.message}</p></article>)}</div> : <p>無補充或提醒</p>}</section><LineSummaryCard announcement={item} /></>}</DialogContent></Dialog>;
}

function DetailList({ title, empty, values }: { title: string; empty: string; values: string[] }) { return <section><h3>{title}</h3>{values.length ? <ul>{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul> : <p>{empty}</p>}</section>; }

function ReadOnlyImages({ item }: { item: Announcement }) { return <section className={styles.readOnlyImages}><h3>公告圖片（唯讀）</h3>{item.attachments.length ? <div>{item.attachments.map(attachment => <figure key={attachment.id}><img src={attachment.url} alt={attachment.caption || attachment.name} /><figcaption><strong>{attachment.name}</strong>{attachment.caption && <span>{attachment.caption}</span>}</figcaption></figure>)}</div> : <p>無公告圖片</p>}</section>; }
