"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, ImagePlus, Link2, Trash2 } from "lucide-react";
import { AUDIENCES, type Announcement, type Audience } from "@/lib/announcements";
import { departmentGroups, type Department } from "@/lib/departments";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/academicYear";
import { MAX_PUBLISH_IMAGES, publishDraftToAnnouncement, removePublishAttachment, selectPublishImages, setPrimaryLink, validateBasicDraft, type BasicAnnouncementDraft, type DraftErrors, type PublishImageAttachment } from "@/lib/publishDraft";
import { AnnouncementPublishError, publishAnnouncement, type PublishStage } from "@/lib/announcementPublishing";
import { ImageCompressionError } from "@/lib/imageCompression";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { LineSummaryCard } from "@/components/line-summary-card";
import styles from "./publish.module.css";

const emptyImportantEvents = () => Array.from({ length: 3 }, () => ({ date: "", time: "", title: "" }));
const emptyDeadlines = () => Array.from({ length: 3 }, () => ({ date: "", time: "", label: "" }));
const createEmptyDraft = (department: Department | "" = ""): BasicAnnouncementDraft => ({ department, title: "", audiences: [], content: "", attachments: [], importantEvents: emptyImportantEvents(), deadlines: emptyDeadlines(), links: [] });

export default function PublishPage() {
  return <AdminAuthGuard><PublishForm /></AdminAuthGuard>;
}

function PublishForm() {
  const publisher = useAuthorizedPublisher();
  const [draft, setDraft] = useState<BasicAnnouncementDraft>(() => createEmptyDraft(publisher.defaultDepartment));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<Announcement | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishedAnnouncement, setPublishedAnnouncement] = useState<Announcement | null>(null);
  const [imageNotice, setImageNotice] = useState("");
  const [publishStage, setPublishStage] = useState<PublishStage | null>(null);
  const publishingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());

  useEffect(() => () => { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear(); }, []);

  const toggleAudience = (audience: Audience, checked: boolean) => {
    setDraft(current => ({ ...current, audiences: checked ? [...current.audiences, audience] : current.audiences.filter(item => item !== audience) }));
  };

  const addImages = (event: ChangeEvent<HTMLInputElement>) => {
    const { accepted, oversizedCount, overLimitCount } = selectPublishImages(Array.from(event.target.files ?? []), draft.attachments.length);
    const additions: PublishImageAttachment[] = accepted.map(file => {
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.add(previewUrl);
      return { id: crypto.randomUUID(), type: "image", name: file.name, caption: "", previewUrl, file };
    });
    if (additions.length) setDraft(current => ({ ...current, attachments: [...current.attachments, ...additions] }));
    const notices = [];
    if (oversizedCount > 0) notices.push("圖片過大，單張原始圖片不可超過 10 MB。");
    if (overLimitCount > 0) notices.push(`已達圖片上限，另有 ${overLimitCount} 張未加入。`);
    setImageNotice(notices.join(" "));
    event.target.value = "";
  };

  const removeImage = (attachment: PublishImageAttachment) => {
    URL.revokeObjectURL(attachment.previewUrl);
    objectUrls.current.delete(attachment.previewUrl);
    setDraft(current => ({ ...current, attachments: removePublishAttachment(current.attachments, attachment.id) }));
    setImageNotice("");
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
    if (Object.keys(nextErrors).length === 0) {
      setPublishError("");
      setPreview(publishDraftToAnnouncement(draft, "prototype-preview", new Date().toISOString(), CURRENT_ACADEMIC_YEAR));
    }
    setPreviewOpen(Object.keys(nextErrors).length === 0);
    if (Object.keys(nextErrors).length > 0) requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
  };

  const confirmPublish = async () => {
    if (publishingRef.current || !preview) return;
    publishingRef.current = true;
    setPublishing(true);
    setPublishStage(draft.attachments.length > 0 ? "processing-images" : "publishing");
    setPublishError("");
    try {
      const announcement = await publishAnnouncement(draft, CURRENT_ACADEMIC_YEAR, setPublishStage);
      setPreviewOpen(false);
      setPublishedAnnouncement(announcement);
    } catch (error) {
      setPublishError(error instanceof ImageCompressionError || error instanceof AnnouncementPublishError ? error.message : "公告發布失敗，請確認網路連線與發布權限後再試一次。");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
      setPublishStage(null);
    }
  };

  if (publishedAnnouncement) {
    return <main className={styles.page}><section className={styles.publishSuccess} role="status"><p>發布完成</p><h1>公告發布成功</h1><span>公告已寫入公務資訊資料庫。</span><LineSummaryCard announcement={publishedAnnouncement} /><Link href="/admin">返回行政工作台</Link></section></main>;
  }

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
        <div className={styles.optionalActions}><Button type="button" variant="outline" onClick={addLink}><Link2 />新增相關網址</Button></div>
        {draft.links.length > 0 && <div className={styles.editorGroup}><h3>相關網址</h3>{draft.links.map((item, index) => <article key={item.id} className={styles.editorCard}><strong>網址 {index + 1}</strong><div className={styles.linkFields}><label>顯示名稱<Input value={item.label} onChange={event => updateLink(item.id, "label", event.target.value)} placeholder="例如：教師研習報名表" /></label><label>網址<Input type="url" value={item.url} onChange={event => updateLink(item.id, "url", event.target.value)} placeholder="https://" /></label><label className={styles.primaryCheck}><Checkbox checked={item.isPrimary} onCheckedChange={value => togglePrimaryLink(item.id, value === true)} />設為主要連結</label></div><Button type="button" variant="ghost" size="sm" onClick={() => removeLink(item.id)}><Trash2 />移除</Button></article>)}</div>}
        <section className={styles.imageSection} aria-labelledby="announcement-images-title"><div className={styles.imageSectionHeader}><div><h3 id="announcement-images-title">公告圖片／附件</h3><p>可一次選擇多張圖片，並為每張圖片補充說明。</p></div>{draft.attachments.length < MAX_PUBLISH_IMAGES && <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><ImagePlus />＋新增圖片</Button>}</div><input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/*" multiple onChange={addImages} />{draft.attachments.length > 0 && <div className={styles.imageGrid}>{draft.attachments.map(attachment => <article key={attachment.id} className={styles.imageCard}><img src={attachment.previewUrl} alt={attachment.caption || attachment.name} /><div><strong title={attachment.name}>{attachment.name}</strong><label>圖片說明（選填）<Input value={attachment.caption} onChange={event => setDraft(current => ({ ...current, attachments: current.attachments.map(item => item.id === attachment.id ? { ...item, caption: event.target.value } : item) }))} placeholder="例如：家長日流程圖" /></label><Button type="button" variant="ghost" size="sm" onClick={() => removeImage(attachment)}><Trash2 />移除</Button></div></article>)}</div>}{draft.attachments.length >= MAX_PUBLISH_IMAGES && <p className={styles.imageLimit}>每則公告最多 5 張圖片</p>}{imageNotice && <p className={styles.imageNotice} role="status">{imageNotice}</p>}<p className={styles.prototypeNote}>圖片會在確認發布後壓縮為 WebP 並上傳。</p></section>
      </section>
      <div className={styles.actions}><span className={styles.hint}>預覽確認後才會正式發布。</span><Button type="submit" size="lg"><Eye />預覽公告</Button></div>
    </form>
    <Dialog open={previewOpen} onOpenChange={open => { if (!publishing) setPreviewOpen(open); }}><DialogContent className={styles.previewDialog} showCloseButton={!publishing}>{preview && <><div className={styles.previewScroll}><DialogHeader><DialogDescription>{preview.department} · {preview.academicYear} 學年度</DialogDescription><DialogTitle>{preview.title}</DialogTitle><div className={styles.previewAudiences}>{preview.audiences.map(item => <span key={item}>{item}</span>)}</div></DialogHeader>{preview.importantEvents.length > 0 && <section className={styles.previewOptional}><h3>重要日期／活動</h3>{preview.importantEvents.map((item, index) => <p key={`${item.date}-${item.time}-${index}`}><strong>{item.date}{item.time ? ` ${item.time}` : ""}</strong><span>{item.title}</span></p>)}</section>}{preview.deadlines.length > 0 && <section className={styles.previewOptional}><h3>繳交／填報期限</h3>{preview.deadlines.map((item, index) => <p key={`${item.date}-${item.time}-${index}`}><strong>{item.date}{item.time ? ` ${item.time}` : ""}</strong><span>{item.label}</span></p>)}</section>}<section className={styles.previewContent}><h3>公告內容</h3><p>{preview.content}</p></section>{preview.links.length > 0 && <section className={styles.previewOptional}><h3>相關連結</h3>{preview.links.map(item => <p key={item.id}><strong>{item.label}{item.isPrimary ? "（主要連結）" : ""}</strong><a href={item.url} target="_blank" rel="noopener noreferrer">開啟連結</a></p>)}</section>}{preview.attachments.length > 0 && <section className={styles.previewImages}><h3>公告圖片／附件</h3><div>{preview.attachments.map(item => <figure key={item.id}><img src={item.url} alt={item.caption || item.name} /><figcaption><strong>{item.name}</strong>{item.caption && <span>{item.caption}</span>}</figcaption></figure>)}</div></section>}</div><footer className={styles.previewFooter}>{publishError && <p role="alert">{publishError}</p>}<div><Button type="button" variant="outline" onClick={() => setPreviewOpen(false)} disabled={publishing}>返回修改</Button><Button type="button" onClick={confirmPublish} disabled={publishing}>{publishing ? publishStageLabel(publishStage) : "確認發布"}</Button></div></footer></>}</DialogContent></Dialog>
  </main>;
}

function publishStageLabel(stage: PublishStage | null) {
  if (stage === "processing-images") return "處理圖片中…";
  if (stage === "uploading-images") return "上傳圖片中…";
  return "發布中…";
}
