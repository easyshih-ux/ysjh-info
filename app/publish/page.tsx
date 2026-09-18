"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, ImagePlus, Link2, Trash2 } from "lucide-react";
import { AUDIENCES, type Announcement, type Audience } from "@/lib/announcements";
import { departmentGroups, type Department } from "@/lib/departments";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/academicYear";
import { isSupportedImage, publishDraftToAnnouncement, removePublishAttachment, setPrimaryLink, validateBasicDraft, type BasicAnnouncementDraft, type DraftErrors, type PublishImageAttachment } from "@/lib/publishDraft";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import styles from "./publish.module.css";

const emptyImportantEvents = () => Array.from({ length: 3 }, () => ({ date: "", time: "", title: "" }));
const emptyDeadlines = () => Array.from({ length: 3 }, () => ({ date: "", time: "", label: "" }));
const emptyDraft: BasicAnnouncementDraft = { department: "", title: "", audiences: [], content: "", attachments: [], importantEvents: emptyImportantEvents(), deadlines: emptyDeadlines(), links: [] };

export default function PublishPage() {
  const [draft, setDraft] = useState<BasicAnnouncementDraft>(emptyDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<Announcement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());

  useEffect(() => () => { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear(); }, []);

  const toggleAudience = (audience: Audience, checked: boolean) => {
    setDraft(current => ({ ...current, audiences: checked ? [...current.audiences, audience] : current.audiences.filter(item => item !== audience) }));
  };

  const addImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(isSupportedImage);
    const additions: PublishImageAttachment[] = files.map(file => {
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.add(previewUrl);
      return { id: crypto.randomUUID(), type: "image", name: file.name, caption: "", previewUrl };
    });
    if (additions.length) setDraft(current => ({ ...current, attachments: [...current.attachments, ...additions] }));
    event.target.value = "";
  };

  const removeImage = (attachment: PublishImageAttachment) => {
    URL.revokeObjectURL(attachment.previewUrl);
    objectUrls.current.delete(attachment.previewUrl);
    setDraft(current => ({ ...current, attachments: removePublishAttachment(current.attachments, attachment.id) }));
  };

  const updateImportantEvent = (index: number, field: "date" | "time" | "title", value: string) => setDraft(current => ({ ...current, importantEvents: current.importantEvents.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const updateDeadline = (index: number, field: "date" | "time" | "label", value: string) => setDraft(current => ({ ...current, deadlines: current.deadlines.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const addLink = () => setDraft(current => ({ ...current, links: [...current.links, { id: crypto.randomUUID(), label: "", url: "", type: "website", isPrimary: false }] }));
  const updateLink = (id: string, field: "label" | "url", value: string) => setDraft(current => ({ ...current, links: current.links.map(item => item.id === id ? { ...item, [field]: value } : item) }));
  const removeLink = (id: string) => setDraft(current => ({ ...current, links: current.links.filter(item => item.id !== id) }));
  const togglePrimaryLink = (id: string, checked: boolean) => setDraft(current => ({ ...current, links: setPrimaryLink(current.links, id, checked) }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateBasicDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) setPreview(publishDraftToAnnouncement(draft, "prototype-preview", new Date().toISOString(), CURRENT_ACADEMIC_YEAR));
    setPreviewOpen(Object.keys(nextErrors).length === 0);
    if (Object.keys(nextErrors).length > 0) requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
  };

  return <main className={styles.page}>
    <header className={styles.header}><div><nav className={styles.headerNav} aria-label="發布頁導覽"><Link href="/admin" className={styles.back}><ArrowLeft />返回發布工作台</Link><Link href="/" className={styles.secondaryBack}>公務資訊站</Link></nav><p>{CURRENT_ACADEMIC_YEAR} 學年度 · 處室登錄 Prototype</p><h1>公務資訊發布</h1><span>登錄需要留存、查詢或提醒的重要公務資訊</span></div></header>
    <form className={styles.form} onSubmit={submit} noValidate>
      <section className={styles.section} aria-labelledby="basic-title">
        <div className={styles.sectionTitle}><span>01</span><div><h2 id="basic-title">基本資料</h2><p>先填寫老師查閱公告時最需要的內容。</p></div></div>
        <div className={styles.fields}>
          <label className={styles.field}><span>發布單位 <em>必填</em></span><select className={styles.departmentSelect} value={draft.department} onChange={event => setDraft(current => ({ ...current, department: event.target.value as Department }))} aria-invalid={!!errors.department} aria-describedby={errors.department ? "department-error" : undefined}><option value="">請選擇發布單位</option>{departmentGroups.map(group => <optgroup key={group.office} label={group.office}>{group.departments.map(item => <option key={item} value={item}>{item}</option>)}</optgroup>)}</select>{errors.department && <small id="department-error" className={styles.error}>{errors.department}</small>}</label>
          <label className={styles.field}><span>公告標題 <em>必填</em></span><Input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="例如：第一次段考命題範圍確認" aria-invalid={!!errors.title} aria-describedby={errors.title ? "title-error" : undefined} />{errors.title && <small id="title-error" className={styles.error}>{errors.title}</small>}</label>
          <fieldset className={styles.fieldset}><legend>適用對象 <em>可複選，必填</em></legend><div className={styles.audienceGrid}>{AUDIENCES.map(audience => { const checked = draft.audiences.includes(audience); return <label key={audience} className={checked ? styles.checked : ""}><Checkbox checked={checked} onCheckedChange={value => toggleAudience(audience, value === true)} aria-invalid={!!errors.audiences} /><span>{audience}</span></label>})}</div>{errors.audiences && <small className={styles.error}>{errors.audiences}</small>}</fieldset>
          <label className={`${styles.field} ${styles.full}`}><span>完整公告內容 <em>必填</em></span><Textarea value={draft.content} onChange={event => setDraft(current => ({ ...current, content: event.target.value }))} placeholder={"可直接貼上原本準備發布到 LINE 的完整文字。\n\n段落、換行與編號都會保留。"} aria-invalid={!!errors.content} aria-describedby={errors.content ? "content-error" : undefined} />{errors.content && <small id="content-error" className={styles.error}>{errors.content}</small>}<small className={styles.hint}>支援長文字、換行、段落與編號。</small></label>
        </div>
      </section>
      <section className={`${styles.section} ${styles.optionalSection}`} aria-labelledby="optional-title">
        <div className={styles.sectionTitle}><span>02</span><div><h2 id="optional-title">選填資訊</h2><p>需要時再加入提醒、連結或公告圖片。</p></div></div>
        <div className={styles.fixedEditor}><div className={styles.editorIntro}><h3>📌 重要日期／活動（選填）</h3><p>哪一天有活動、會議或事情要發生？</p><small>例如：9/20 07:52 晨讀公播、9/26 18:30 家長日</small></div>{draft.importantEvents.map((item, index) => <article key={index} className={styles.editorCard}><strong>重要事項{["①","②","③"][index]}</strong><div className={styles.threeFields}><label>日期<Input type="date" value={item.date} onChange={event => updateImportantEvent(index, "date", event.target.value)} /></label><label>時間（選填）<Input type="time" value={item.time ?? ""} onChange={event => updateImportantEvent(index, "time", event.target.value)} /></label><label>事項名稱<Input value={item.title} onChange={event => updateImportantEvent(index, "title", event.target.value)} placeholder="例如：晨讀公播" /></label></div></article>)}{errors.importantEvents && <small className={styles.error}>{errors.importantEvents}</small>}</div>
        <div className={styles.fixedEditor}><div className={styles.editorIntro}><h3>⏰ 繳交／填報期限（選填）</h3><p>這篇公告有資料、回條或表單需要在期限前完成嗎？</p><small>例如：9/20 第八節通知單繳回、9/21 原住民調查表繳回</small></div>{draft.deadlines.map((item, index) => <article key={index} className={styles.editorCard}><strong>繳交期限{["①","②","③"][index]}</strong><div className={styles.threeFields}><label>截止日期<Input type="date" value={item.date} onChange={event => updateDeadline(index, "date", event.target.value)} /></label><label>時間（選填）<Input type="time" value={item.time ?? ""} onChange={event => updateDeadline(index, "time", event.target.value)} /></label><label>繳交／完成事項<Input value={item.label} onChange={event => updateDeadline(index, "label", event.target.value)} placeholder="例如：調查表繳交截止" /></label></div></article>)}{errors.deadlines && <small className={styles.error}>{errors.deadlines}</small>}</div>
        <div className={styles.optionalActions}><Button type="button" variant="outline" onClick={addLink}><Link2 />新增相關網址</Button><Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><ImagePlus />新增圖片</Button></div>
        {draft.links.length > 0 && <div className={styles.editorGroup}><h3>相關網址</h3>{draft.links.map((item, index) => <article key={item.id} className={styles.editorCard}><strong>網址 {index + 1}</strong><div className={styles.linkFields}><label>顯示名稱<Input value={item.label} onChange={event => updateLink(item.id, "label", event.target.value)} placeholder="例如：教師研習報名表" /></label><label>網址<Input type="url" value={item.url} onChange={event => updateLink(item.id, "url", event.target.value)} placeholder="https://" /></label><label className={styles.primaryCheck}><Checkbox checked={item.isPrimary} onCheckedChange={value => togglePrimaryLink(item.id, value === true)} />設為主要連結</label></div><Button type="button" variant="ghost" size="sm" onClick={() => removeLink(item.id)}><Trash2 />移除</Button></article>)}</div>}
        <input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/*" multiple onChange={addImages} />{draft.attachments.length > 0 && <div className={styles.editorGroup}><h3>公告圖片</h3><div className={styles.imageGrid}>{draft.attachments.map(attachment => <article key={attachment.id} className={styles.imageCard}><img src={attachment.previewUrl} alt={attachment.caption || attachment.name} /><div><strong title={attachment.name}>{attachment.name}</strong><label>圖片說明（選填）<Input value={attachment.caption} onChange={event => setDraft(current => ({ ...current, attachments: current.attachments.map(item => item.id === attachment.id ? { ...item, caption: event.target.value } : item) }))} placeholder="例如：家長日流程圖" /></label><Button type="button" variant="ghost" size="sm" onClick={() => removeImage(attachment)}><Trash2 />移除</Button></div></article>)}</div></div>}<p className={styles.prototypeNote}>圖片僅供本次瀏覽器預覽，不會上傳或永久保存。</p>
      </section>
      <div className={styles.actions}><span className={styles.hint}>此 Prototype 不會儲存或送出資料。</span><Button type="submit" size="lg"><Eye />預覽公告</Button></div>
    </form>
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent className={styles.previewDialog}>{preview && <><DialogHeader><DialogDescription>{preview.department} · {preview.academicYear} 學年度</DialogDescription><DialogTitle>{preview.title}</DialogTitle><div className={styles.previewAudiences}>{preview.audiences.map(item => <span key={item}>{item}</span>)}</div></DialogHeader>{preview.importantEvents.length > 0 && <section className={styles.previewOptional}><h3>重要日期／活動</h3>{preview.importantEvents.map((item, index) => <p key={`${item.date}-${item.time}-${index}`}><strong>{item.date}{item.time ? ` ${item.time}` : ""}</strong><span>{item.title}</span></p>)}</section>}{preview.deadlines.length > 0 && <section className={styles.previewOptional}><h3>繳交／填報期限</h3>{preview.deadlines.map((item, index) => <p key={`${item.date}-${item.time}-${index}`}><strong>{item.date}{item.time ? ` ${item.time}` : ""}</strong><span>{item.label}</span></p>)}</section>}<section className={styles.previewContent}><h3>公告內容</h3><p>{preview.content}</p></section>{preview.links.length > 0 && <section className={styles.previewOptional}><h3>相關連結</h3>{preview.links.map(item => <p key={item.id}><strong>{item.label}{item.isPrimary ? "（主要連結）" : ""}</strong><a href={item.url} target="_blank" rel="noopener noreferrer">開啟連結</a></p>)}</section>}{preview.attachments.length > 0 && <section className={styles.previewImages}><h3>公告圖片／附件</h3><div>{preview.attachments.map(item => <figure key={item.id}><img src={item.url} alt={item.caption || item.name} /><figcaption><strong>{item.name}</strong>{item.caption && <span>{item.caption}</span>}</figcaption></figure>)}</div></section>}</>}</DialogContent></Dialog>
  </main>;
}
