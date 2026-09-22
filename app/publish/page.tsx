"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, FileText, ImagePlus, Link2, Trash2 } from "lucide-react";
import { AUDIENCES, formatImportantEventSchedule, toggleAudienceSelection, type Announcement, type Audience } from "@/lib/announcements";
import { MAX_CUSTOM_DEPARTMENT_LENGTH, OTHER_DEPARTMENT_OPTION, type Department } from "@/lib/departments";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/academicYear";
import { MAX_PUBLISH_IMAGES, normalizeOptionalHttpUrl, publishDraftToAnnouncement, removePublishAttachment, selectPublishImages, setPrimaryLink, validateBasicDraft, type BasicAnnouncementDraft, type DraftErrors, type PublishImageAttachment, type PublishPdfAttachment } from "@/lib/publishDraft";
import { formatFileSize, MAX_PUBLISH_PDFS, sanitizeAttachmentName, selectPublishPdfs } from "@/lib/attachmentFiles";
import { AnnouncementPublishError, publishAnnouncement, type PublishStage } from "@/lib/announcementPublishing";
import { ImageCompressionError } from "@/lib/imageCompression";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { LineSummaryCard } from "@/components/line-summary-card";
import { DepartmentOptionGroups } from "@/components/department-option-groups";
import { AnnouncementContactLine } from "@/components/announcement-contact";
import { hasPublishAttachments, validateAttachmentPrivacyConfirmation } from "@/lib/attachmentPrivacyConfirmation";
import { defaultContactForDepartment, getFixedDepartmentExtension, MAX_CONTACT_EXTENSION_LENGTH, selectContactDepartment } from "@/lib/departmentContacts";
import styles from "./publish.module.css";

const emptyImportantEvents = () => Array.from({ length: 3 }, () => ({ date: "", time: "", title: "" }));
const emptyDeadlines = () => Array.from({ length: 3 }, () => ({ date: "", time: "", label: "" }));
const createEmptyDraft = (department: Department | "" = ""): BasicAnnouncementDraft => ({ department, title: "", audiences: [], content: "", contact: defaultContactForDepartment(department), attachments: [], pdfAttachments: [], importantEvents: emptyImportantEvents(), deadlines: emptyDeadlines(), links: [] });

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
  const [pdfNotice, setPdfNotice] = useState("");
  const [attachmentPrivacyConfirmed, setAttachmentPrivacyConfirmed] = useState(false);
  const [attachmentPrivacyError, setAttachmentPrivacyError] = useState("");
  const [publishStage, setPublishStage] = useState<PublishStage | null>(null);
  const publishingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());

  useEffect(() => () => { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear(); }, []);

  const toggleAudience = (audience: Audience, checked: boolean) => {
    setDraft(current => ({ ...current, audiences: toggleAudienceSelection(current.audiences, audience, checked) }));
  };

  const addImages = (event: ChangeEvent<HTMLInputElement>) => {
    const { accepted, oversizedCount, overLimitCount } = selectPublishImages(Array.from(event.target.files ?? []), draft.attachments.length);
    const additions: PublishImageAttachment[] = accepted.map(file => {
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.add(previewUrl);
      return { id: crypto.randomUUID(), type: "image", name: file.name, caption: "", previewUrl, file };
    });
    if (additions.length) {
      setDraft(current => ({ ...current, attachments: [...current.attachments, ...additions] }));
      setAttachmentPrivacyConfirmed(false);
      setAttachmentPrivacyError("");
    }
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
    setAttachmentPrivacyConfirmed(false);
    setAttachmentPrivacyError("");
    setImageNotice("");
  };

  const updateImportantEvent = (index: number, field: "date" | "time" | "endDate" | "endTime" | "title", value: string) => setDraft(current => ({ ...current, importantEvents: current.importantEvents.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const updateDeadline = (index: number, field: "date" | "time" | "label", value: string) => setDraft(current => ({ ...current, deadlines: current.deadlines.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const addLink = () => setDraft(current => ({ ...current, links: [...current.links, { id: crypto.randomUUID(), label: "", url: "", type: "website", isPrimary: false }] }));
  const updateLink = (id: string, field: "label" | "url", value: string) => setDraft(current => ({ ...current, links: current.links.map(item => item.id === id ? { ...item, [field]: value } : item) }));
  const removeLink = (id: string) => setDraft(current => ({ ...current, links: current.links.filter(item => item.id !== id) }));
  const togglePrimaryLink = (id: string, checked: boolean) => setDraft(current => ({ ...current, links: setPrimaryLink(current.links, id, checked) }));

  const normalizeLink = (id: string) => setDraft(current => ({
    ...current,
    links: current.links.map(item => item.id === id ? { ...item, url: normalizeOptionalHttpUrl(item.url).value } : item),
  }));

  const focusFirstError = (validationErrors: DraftErrors) => requestAnimationFrame(() => {
    const firstError = Object.keys(validationErrors)[0] as keyof DraftErrors | undefined;
    const selectorByError: Partial<Record<keyof DraftErrors, string>> = {
      department: "select[name='department']",
      title: "input[name='title']",
      audiences: "fieldset button",
      content: "textarea[name='content']",
      contact: `.${styles.contactSection} [aria-invalid='true']`,
      links: `.${styles.editorGroup} [aria-invalid='true']`,
    };
    const selector = firstError ? selectorByError[firstError] : undefined;
    const fixedEditors = formRef.current?.querySelectorAll<HTMLElement>(`.${styles.fixedEditor}`);
    const attachmentTypes = formRef.current?.querySelectorAll<HTMLElement>(`.${styles.attachmentType}`);
    const target = firstError === "importantEvents"
      ? fixedEditors?.[0]?.querySelector<HTMLElement>("input")
      : firstError === "deadlines"
        ? fixedEditors?.[1]?.querySelector<HTMLElement>("input")
        : firstError === "attachments"
          ? attachmentTypes?.[0]?.querySelector<HTMLElement>("button")
          : firstError === "pdfAttachments"
            ? attachmentTypes?.[1]?.querySelector<HTMLElement>("button")
            : selector
              ? formRef.current?.querySelector<HTMLElement>(selector)
              : undefined;
    if (!target) return;
    if (!target.hasAttribute("aria-invalid")) {
      target.setAttribute("aria-invalid", "true");
      target.dataset.validationHighlight = "true";
    }
    target.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  });

  const validateForPublish = () => {
    formRef.current?.querySelectorAll<HTMLElement>("[data-validation-highlight='true']").forEach(target => {
      target.removeAttribute("aria-invalid");
      delete target.dataset.validationHighlight;
    });
    const normalizedDraft: BasicAnnouncementDraft = {
      ...draft,
      links: draft.links.map(item => ({ ...item, url: normalizeOptionalHttpUrl(item.url).value })),
    };
    const nextErrors = validateBasicDraft(normalizedDraft);
    if (imageNotice) nextErrors.attachments = imageNotice;
    if (pdfNotice) nextErrors.pdfAttachments = pdfNotice;
    setDraft(normalizedDraft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setPreviewOpen(false);
      setPublishError("");
      focusFirstError(nextErrors);
      return null;
    }
    return normalizedDraft;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const validatedDraft = validateForPublish();
    if (!validatedDraft) return;
    setPublishError("");
    setPreview(publishDraftToAnnouncement(validatedDraft, "prototype-preview", new Date().toISOString(), CURRENT_ACADEMIC_YEAR));
    setPreviewOpen(true);
  };

  const addPdfs = (event: ChangeEvent<HTMLInputElement>) => {
    const current = draft.pdfAttachments ?? [];
    const { accepted, invalidTypeCount, oversizedCount, overLimitCount } = selectPublishPdfs(Array.from(event.target.files ?? []), current.length);
    const additions: PublishPdfAttachment[] = accepted.map(file => ({
      id: crypto.randomUUID(),
      type: "pdf",
      name: sanitizeAttachmentName(file.name),
      sizeBytes: file.size,
      file,
    }));
    if (additions.length) {
      setDraft(value => ({ ...value, pdfAttachments: [...(value.pdfAttachments ?? []), ...additions] }));
      setAttachmentPrivacyConfirmed(false);
      setAttachmentPrivacyError("");
    }
    const notices = [];
    if (invalidTypeCount > 0) notices.push("只接受 PDF 文件（.pdf）。");
    if (oversizedCount > 0) notices.push("PDF 單檔不可超過 5 MB。");
    if (overLimitCount > 0) notices.push(`每則公告最多 2 份 PDF，另有 ${overLimitCount} 份未加入。`);
    setPdfNotice(notices.join(" "));
    event.target.value = "";
  };

  const removePdf = (id: string) => {
    setDraft(current => ({ ...current, pdfAttachments: (current.pdfAttachments ?? []).filter(item => item.id !== id) }));
    setAttachmentPrivacyConfirmed(false);
    setAttachmentPrivacyError("");
    setPdfNotice("");
  };

  const confirmPublish = async () => {
    if (publishingRef.current || !preview) return;
    const validatedDraft = validateForPublish();
    if (!validatedDraft) return;
    const privacyError = validateAttachmentPrivacyConfirmation(validatedDraft, attachmentPrivacyConfirmed);
    if (privacyError) {
      setAttachmentPrivacyError(privacyError);
      return;
    }
    setAttachmentPrivacyError("");
    publishingRef.current = true;
    setPublishing(true);
    setPublishStage(draft.attachments.length > 0 ? "processing-images" : (draft.pdfAttachments?.length ?? 0) > 0 ? "uploading-pdfs" : "publishing");
    setPublishError("");
    try {
      const announcement = await publishAnnouncement(validatedDraft, CURRENT_ACADEMIC_YEAR, setPublishStage, {
        uid: publisher.uid,
        email: publisher.email,
        displayName: publisher.displayName,
      });
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
    return <main className={styles.page}><section className={styles.publishSuccess} role="status"><p>發布完成</p><h1>公告發布成功</h1><span>公告已寫入公務資訊資料庫。</span><LineSummaryCard announcement={publishedAnnouncement} /><Link href="/admin">返回行政管理</Link></section></main>;
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><nav className={styles.headerNav} aria-label="發布頁導覽"><Link href="/admin" className={styles.back}><ArrowLeft />返回行政管理</Link><Link href="/" className={styles.secondaryBack}>公務資訊站</Link></nav><p>{CURRENT_ACADEMIC_YEAR} 學年度 · 處室登錄 Prototype</p><h1>公務資訊發布</h1><span>登錄需要留存、查詢或提醒的重要公務資訊</span></div></header>
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      {Object.keys(errors).length > 0 && <section className={styles.errorSummary} role="alert" aria-labelledby="validation-summary-title"><strong id="validation-summary-title">尚有資料需要修正</strong><ul>{[...new Set(Object.values(errors).filter((message): message is string => !!message))].map(message => <li key={message}>{message}</li>)}</ul></section>}
      <section className={styles.section} aria-labelledby="basic-title">
        <div className={styles.sectionTitle}><span>01</span><div><h2 id="basic-title">基本資料</h2><p>先填寫老師查閱公告時最需要的內容。</p></div></div>
        <div className={styles.fields}>
          <label className={styles.field}><span>發布單位 <em>必填</em></span><select name="department" className={styles.departmentSelect} value={draft.department} onChange={event => setDraft(current => ({ ...current, department: event.target.value as Department }))} aria-invalid={!!errors.department} aria-describedby={errors.department ? "department-error" : undefined}><option value="">請選擇發布單位</option><DepartmentOptionGroups currentDepartment={draft.department} /></select>{errors.department && <small id="department-error" className={styles.error}>{errors.department}</small>}</label>
          <label className={styles.field}><span>公告標題 <em>必填</em></span><Input name="title" value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="例如：第一次段考命題範圍確認" aria-invalid={!!errors.title} aria-describedby={errors.title ? "title-error" : undefined} />{errors.title && <small id="title-error" className={styles.error}>{errors.title}</small>}</label>
          <fieldset className={styles.fieldset} data-validation-field="audiences"><legend>適用對象 <em>可複選，必填</em></legend><div className={styles.audienceGrid}>{AUDIENCES.map(audience => { const checked = draft.audiences.includes(audience); return <label key={audience} className={checked ? styles.checked : ""}><Checkbox checked={checked} onCheckedChange={value => toggleAudience(audience, value === true)} aria-invalid={!!errors.audiences} /><span>{audience}</span></label>})}</div>{errors.audiences && <small className={styles.error}>{errors.audiences}</small>}</fieldset>
          <label className={`${styles.field} ${styles.full}`}><span>完整公告內容 <em>必填</em></span><Textarea name="content" value={draft.content} onChange={event => setDraft(current => ({ ...current, content: event.target.value }))} placeholder={"可直接貼上原本準備發布到 LINE 的完整文字。\n\n段落、換行與編號都會保留。"} aria-invalid={!!errors.content} aria-describedby={errors.content ? "content-error" : undefined} />{errors.content && <small id="content-error" className={styles.error}>{errors.content}</small>}<small className={styles.hint}>支援長文字、換行、段落與編號。</small></label>
        </div>
      </section>
      <section className={`${styles.section} ${styles.optionalSection}`} aria-labelledby="optional-title">
        <div className={styles.sectionTitle}><span>02</span><div><h2 id="optional-title">選填資訊</h2><p>需要時再加入提醒、連結或公告圖片。</p></div></div>
        <div className={styles.fixedEditor}><div className={styles.editorIntro}><h3>📌 重要日期／活動（選填）</h3><p>哪一天有活動、會議或事情要發生？</p><small>例如：9/20 07:52 晨讀公播、9/26 18:30 家長日</small></div>{draft.importantEvents.map((item, index) => <article key={index} className={styles.editorCard}><strong>重要事項{["①","②","③"][index]}</strong><div className={styles.threeFields}><label>開始日期<Input type="date" value={item.date} onChange={event => updateImportantEvent(index, "date", event.target.value)} /></label><label>開始時間（選填）<Input type="time" value={item.time ?? ""} onChange={event => updateImportantEvent(index, "time", event.target.value)} />{item.time && <button className={styles.clearTime} type="button" onClick={() => updateImportantEvent(index, "time", "")}>清除時間</button>}</label><label>結束日期（選填）<Input type="date" min={item.date || undefined} value={item.endDate ?? ""} onChange={event => updateImportantEvent(index, "endDate", event.target.value)} /></label><label>結束時間（選填）<Input type="time" value={item.endTime ?? ""} onChange={event => updateImportantEvent(index, "endTime", event.target.value)} />{item.endTime && <button className={styles.clearTime} type="button" onClick={() => updateImportantEvent(index, "endTime", "")}>清除時間</button>}</label><label>事項名稱<Input value={item.title} onChange={event => updateImportantEvent(index, "title", event.target.value)} placeholder="例如：晨讀公播" /></label></div></article>)}{errors.importantEvents && <small className={styles.error}>{errors.importantEvents}</small>}</div>
        <div className={styles.fixedEditor}><div className={styles.editorIntro}><h3>⏰ 繳交／填報期限（選填）</h3><p>這篇公告有資料、回條或表單需要在期限前完成嗎？</p><small>例如：9/20 第八節通知單繳回、9/21 原住民調查表繳回</small></div>{draft.deadlines.map((item, index) => <article key={index} className={styles.editorCard}><strong>繳交期限{["①","②","③"][index]}</strong><div className={styles.threeFields}><label>截止日期<Input type="date" value={item.date} onChange={event => updateDeadline(index, "date", event.target.value)} /></label><label>時間（選填）<Input type="time" value={item.time ?? ""} onChange={event => updateDeadline(index, "time", event.target.value)} /></label><label>繳交／完成事項<Input value={item.label} onChange={event => updateDeadline(index, "label", event.target.value)} placeholder="例如：調查表繳交截止" /></label></div></article>)}{errors.deadlines && <small className={styles.error}>{errors.deadlines}</small>}</div>
        <div className={styles.optionalActions}><Button type="button" variant="outline" onClick={addLink}><Link2 />新增相關網址</Button></div>
        {draft.links.length > 0 && <div className={styles.editorGroup}><h3>相關網址</h3>{draft.links.map((item, index) => {
          const urlResult = normalizeOptionalHttpUrl(item.url);
          const urlError = item.url.trim() ? urlResult.error : undefined;
          const missingLabel = !!errors.links && !item.label.trim() && !!item.url.trim();
          const missingUrl = !!errors.links && !!item.label.trim() && !item.url.trim();
          return <article key={item.id} className={styles.editorCard}><strong>網址 {index + 1}</strong><div className={styles.linkFields}><label>顯示名稱<Input value={item.label} onChange={event => updateLink(item.id, "label", event.target.value)} placeholder="例如：教師研習報名表" aria-invalid={missingLabel} />{missingLabel && <small className={styles.error}>請輸入相關連結名稱</small>}</label><label>網址<Input type="url" value={item.url} onChange={event => updateLink(item.id, "url", event.target.value)} onBlur={() => normalizeLink(item.id)} placeholder="https://" aria-invalid={!!urlError || missingUrl} />{urlError && <small className={styles.error}>{urlError}</small>}{missingUrl && <small className={styles.error}>請輸入相關連結網址</small>}</label><label className={styles.primaryCheck}><Checkbox checked={item.isPrimary} onCheckedChange={value => togglePrimaryLink(item.id, value === true)} />設為主要連結</label></div><Button type="button" variant="ghost" size="sm" onClick={() => removeLink(item.id)}><Trash2 />移除</Button></article>;
        })}{errors.links && <small className={styles.error}>{errors.links}</small>}</div>}
        <section className={styles.contactSection} aria-labelledby="contact-title"><div className={styles.contactHeading}><div><h3 id="contact-title">業務聯絡資訊</h3><p>使用單位與校內分機，方便讀者洽詢公告業務。</p></div><label><Checkbox checked={!!draft.contact} onCheckedChange={checked => setDraft(current => ({ ...current, contact: checked === true ? defaultContactForDepartment(current.department) : undefined }))} />顯示業務聯絡資訊</label></div>{draft.contact && <div className={styles.contactFields}><label>聯絡單位<select value={getFixedDepartmentExtension(draft.contact.department) ? draft.contact.department : OTHER_DEPARTMENT_OPTION} onChange={event => setDraft(current => current.contact ? ({ ...current, contact: selectContactDepartment(current.contact, event.target.value) }) : current)}><DepartmentOptionGroups includeOther /></select></label>{getFixedDepartmentExtension(draft.contact.department) ? <label>校內分機<Input value={getFixedDepartmentExtension(draft.contact.department)} readOnly /></label> : <><label>實際聯絡單位名稱<Input name="contactDepartment" maxLength={MAX_CUSTOM_DEPARTMENT_LENGTH} value={draft.contact.department} onChange={event => setDraft(current => current.contact ? ({ ...current, contact: { ...current.contact, department: event.target.value } }) : current)} aria-invalid={!!errors.contact} /></label><label>校內分機<Input name="contactExtension" inputMode="numeric" maxLength={MAX_CONTACT_EXTENSION_LENGTH} value={draft.contact.extension} onChange={event => setDraft(current => current.contact ? ({ ...current, contact: { ...current.contact, extension: event.target.value } }) : current)} aria-invalid={!!errors.contact} placeholder="例如：123" /></label></>}{errors.contact && <small className={styles.error}>{errors.contact}</small>}</div>}</section>
        <section className={styles.imageSection} aria-labelledby="announcement-attachments-title"><h3 id="announcement-attachments-title">附件</h3><div className={styles.attachmentType}><div className={styles.imageSectionHeader}><div><h4>圖片</h4><p>支援現有圖片格式，最多 5 張；發布時會壓縮為 WebP。</p></div>{draft.attachments.length < MAX_PUBLISH_IMAGES && <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><ImagePlus />＋新增圖片</Button>}</div><input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/*" multiple onChange={addImages} />{draft.attachments.length > 0 && <div className={styles.imageGrid}>{draft.attachments.map(attachment => <article key={attachment.id} className={styles.imageCard}><img src={attachment.previewUrl} alt={attachment.caption || attachment.name} /><div><strong title={attachment.name}>{attachment.name}</strong><label>圖片說明（選填）<Input value={attachment.caption} onChange={event => setDraft(current => ({ ...current, attachments: current.attachments.map(item => item.id === attachment.id ? { ...item, caption: event.target.value } : item) }))} placeholder="例如：家長日流程圖" /></label><Button type="button" variant="ghost" size="sm" onClick={() => removeImage(attachment)}><Trash2 />移除</Button></div></article>)}</div>}{draft.attachments.length >= MAX_PUBLISH_IMAGES && <p className={styles.imageLimit}>每則公告最多 5 張圖片</p>}{imageNotice && <p className={styles.imageNotice} role="status">{imageNotice}</p>}</div><div className={styles.attachmentType}><div className={styles.imageSectionHeader}><div><h4>PDF 文件</h4><p>最多 2 份，單檔上限 5 MB。</p></div>{(draft.pdfAttachments?.length ?? 0) < MAX_PUBLISH_PDFS && <Button type="button" variant="outline" onClick={() => pdfInputRef.current?.click()}><FileText />＋新增 PDF</Button>}</div><input ref={pdfInputRef} className={styles.fileInput} type="file" accept="application/pdf,.pdf" multiple onChange={addPdfs} />{(draft.pdfAttachments?.length ?? 0) > 0 && <div className={styles.pdfList}>{draft.pdfAttachments?.map(attachment => <article key={attachment.id} className={styles.pdfCard}><FileText aria-hidden="true" /><div><strong title={attachment.name}>{attachment.name}</strong><span>PDF・{formatFileSize(attachment.sizeBytes)}</span></div><Button type="button" variant="ghost" size="sm" onClick={() => removePdf(attachment.id)}><Trash2 />移除</Button></article>)}</div>}{(draft.pdfAttachments?.length ?? 0) >= MAX_PUBLISH_PDFS && <p className={styles.imageLimit}>每則公告最多 2 份 PDF</p>}{pdfNotice && <p className={styles.imageNotice} role="alert">{pdfNotice}</p>}</div>{hasPublishAttachments(draft) && <aside className={styles.attachmentPrivacyNotice}><strong>⚠️ 附件公開提醒</strong><p>本站公告及附件可供公開瀏覽。若內容包含學生、家長或教職員資料，請確認與公告目的相關且有公開必要，並避免包含身分證字號、私人電話、住址、生日等不必要或不宜公開的個人資料。</p></aside>}</section>
      </section>
      <div className={styles.actions}><span className={styles.hint}>預覽確認後才會正式發布。</span><Button className={styles.previewButton} type="submit" size="lg"><Eye />預覽公告</Button></div>
    </form>
    <Dialog open={previewOpen} onOpenChange={open => { if (!publishing) setPreviewOpen(open); }}><DialogContent className={styles.previewDialog} showCloseButton={!publishing}>{preview && <><div className={styles.previewScroll}><DialogHeader><DialogDescription>{preview.department} · {preview.academicYear} 學年度</DialogDescription><DialogTitle>{preview.title}</DialogTitle><div className={styles.previewAudiences}>{preview.audiences.map(item => <span key={item}>{item}</span>)}</div></DialogHeader>{preview.importantEvents.length > 0 && <section className={styles.previewOptional}><h3>重要日期／活動</h3>{preview.importantEvents.map((item, index) => <p key={`${item.date}-${item.time}-${index}`}><strong>{formatImportantEventSchedule(item)}</strong><span>{item.title}</span></p>)}</section>}{preview.deadlines.length > 0 && <section className={styles.previewOptional}><h3>繳交／填報期限</h3>{preview.deadlines.map((item, index) => <p key={`${item.date}-${item.time}-${index}`}><strong>{item.date}{item.time ? ` ${item.time}` : ""}</strong><span>{item.label}</span></p>)}</section>}<section className={styles.previewContent}><h3>公告內容</h3><p>{preview.content}</p></section><AnnouncementContactLine contact={preview.contact} className={styles.contactPreview} />{preview.links.length > 0 && <section className={styles.previewOptional}><h3>相關連結</h3>{preview.links.map(item => <p key={item.id}><strong>{item.label}{item.isPrimary ? "（主要連結）" : ""}</strong><a href={item.url} target="_blank" rel="noopener noreferrer">開啟連結</a></p>)}</section>}{preview.attachments.length > 0 && <section className={styles.previewImages}><h3>公告圖片</h3><div>{preview.attachments.map(item => item.type === "image" && <figure key={item.id}><img src={item.url} alt={item.caption || item.name} /><figcaption><strong>{item.name}</strong>{item.caption && <span>{item.caption}</span>}</figcaption></figure>)}</div></section>}{(draft.pdfAttachments?.length ?? 0) > 0 && <section className={styles.previewPdfs}><h3>PDF 文件</h3>{draft.pdfAttachments?.map(item => <article key={item.id}><FileText /><div><strong>{item.name}</strong><span>PDF・{formatFileSize(item.sizeBytes)}</span></div></article>)}</section>}</div><footer className={styles.previewFooter}>{hasPublishAttachments(draft) && <label className={styles.attachmentPrivacyConfirmation}><Checkbox checked={attachmentPrivacyConfirmed} onCheckedChange={value => { setAttachmentPrivacyConfirmed(value === true); if (value === true) setAttachmentPrivacyError(""); }} aria-invalid={!!attachmentPrivacyError} /><span>我已確認附件內容適合公開，且未包含與公告目的無關或不宜公開的個人資料。</span></label>}{attachmentPrivacyError && <p role="alert">{attachmentPrivacyError}</p>}{publishError && <p role="alert">{publishError}</p>}<div><Button type="button" variant="outline" onClick={() => setPreviewOpen(false)} disabled={publishing}>返回修改</Button><Button className={styles.publishButton} type="button" onClick={confirmPublish} disabled={publishing}>{publishing ? publishStageLabel(publishStage) : "確認發布"}</Button></div></footer></>}</DialogContent></Dialog>
  </main>;
}

function publishStageLabel(stage: PublishStage | null) {
  if (stage === "processing-images") return "處理圖片中…";
  if (stage === "uploading-images") return "上傳圖片中…";
  if (stage === "uploading-pdfs") return "上傳 PDF 中…";
  return "發布中…";
}
