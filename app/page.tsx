"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, CalendarDays, ChevronRight, Clock3, FileText, ImageIcon, Search, Settings, ZoomIn } from "lucide-react";
import { USER_IDENTITIES, formatImportantEventSchedule, resolveLineNotificationLevel, formatLatestFollowUpLabel, type Announcement, type ImageAttachment, type PdfAttachment, type Audience, type UserIdentity } from "@/lib/announcements";
import { formatFileSize } from "@/lib/attachmentFiles";
import { announcementsForIdentity, chasingAnnouncements, importantNoticeAnnouncements, visibleImportantNotices, daysUntil, deadlineDateLabel, deadlineRelativeLabel, deadlineUrgency, filterAnnouncements, importantEventDateLabel, needsAcademicYearConfirmation, nextWeekBounds, nextWeekEvents, readSavedIdentity, saveIdentity, type SavedIdentity, upcomingDeadlines, weekBounds, weeklyEventDisplay, weeklyEvents } from "@/lib/announcementLogic";
import { announcementsForAcademicYear, CURRENT_ACADEMIC_YEAR, FRONTEND_ACADEMIC_YEARS } from "@/lib/academicYear";
import { readPublicAnnouncements } from "@/lib/announcementFirestore";
import { formatImageAudienceLabel, visibleImagesFor, type ImageAudienceStatus } from "@/lib/imageAudiences";
import { readAnnouncementIdFromSearch, resolveAnnouncementDeepLink, withAnnouncementQuery } from "@/lib/announcementDeepLink";
import { mergeAnnouncementFollowUps, readAnnouncementFollowUps } from "@/lib/announcementFollowUps";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DepartmentOptionGroups } from "@/components/department-option-groups";
import { AnnouncementContactLine } from "@/components/announcement-contact";
import { HomeScreenInstall } from "@/components/home-screen-install";
import { departmentVisualFamily } from "@/lib/departmentVisual";
import { AnnouncementUpdateBadges } from "@/components/announcement-update-badges";
import { NoticeLevelBadge } from "@/components/notice-level-badge";
import { PublicAnnouncementFollowUps } from "@/components/public-announcement-follow-ups";
import { activeOriginalFollowUps } from "@/lib/announcementWithdrawnFollowUps";
import { AnalyticsConsent } from "@/components/analytics-consent";
import { trackAnnouncementOpen, type AnnouncementOpenSource } from "@/lib/publicAnalytics";
import { calendarDateKey, formatCalendarDate, taipeiDateKey } from "@/lib/taipeiDate";
import { useTaipeiNow } from "@/hooks/use-taipei-now";

const fmtDate = formatCalendarDate;
const fmtPublished = (value: string) => new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const sortedFollowUps = (announcement: Announcement) => [...announcement.followUps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const relatedFollowUps = (announcement: Announcement) => sortedFollowUps(announcement).filter(item => item.type === "related");
const primaryLink = (announcement: Announcement) => announcement.links.find(link => link.isPrimary);
function AudienceTags({ values }: { values: readonly Audience[] }) { return <div className="tag-row">{values.map(value => <span className="tag" key={value}>{value}</span>)}</div>; }
function DepartmentBadge({ department }: { department: string }) { return <span className={`department-badge department-${departmentVisualFamily(department)}`}>{department}</span>; }
function DepartmentAudienceMeta({ department, audiences }: { department: string; audiences: readonly Audience[] }) { return <small className="department-audience-meta"><DepartmentBadge department={department} /><span aria-hidden="true">｜</span><span>{audiences.join("、")}</span></small>; }
function IdentityChoices({ onChoose }: { onChoose: (identity: SavedIdentity) => void }) { return <div className="identity-choices">{USER_IDENTITIES.map(identity => <button key={identity} onClick={() => onChoose(identity)}>{identity}<ChevronRight /></button>)}<button className="all-choice" onClick={() => onChoose("全部")}>查看全部公告</button></div>; }
function AnnouncementImage({ attachment, className }: { attachment: ImageAttachment; className?: string }) { const [failed, setFailed] = useState(false); return failed ? <div className={`image-fallback ${className ?? ""}`} role="img" aria-label={`${attachment.name} 圖片無法載入`}><ImageIcon aria-hidden="true" />圖片暫時無法顯示</div> : <img className={className} src={attachment.url} alt={attachment.caption || attachment.name} onError={() => setFailed(true)} />; }
function PdfAttachmentCard({ attachment }: { attachment: PdfAttachment }) { return <a className="pdf-attachment-card" href={attachment.url} target="_blank" rel="noopener noreferrer"><FileText aria-hidden="true" /><span><strong>{attachment.name}</strong><small>PDF・{formatFileSize(attachment.sizeBytes)}</small></span><em>開啟文件 ↗</em></a>; }

export default function Home() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [announcementsError, setAnnouncementsError] = useState(false);
  const now = useTaipeiNow();
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [loadedFollowUps, setLoadedFollowUps] = useState<Record<string, Announcement["followUps"]>>({});
  const [previewAttachment, setPreviewAttachment] = useState<ImageAttachment | null>(null);
  const [identity, setIdentity] = useState<SavedIdentity | null | undefined>(undefined);
  const [newAcademicYear, setNewAcademicYear] = useState(false);
  const [viewMode, setViewMode] = useState<"related" | "all">("related");
  const [searchAcademicYear, setSearchAcademicYear] = useState<number>(CURRENT_ACADEMIC_YEAR);
  const [switchingIdentity, setSwitchingIdentity] = useState(false);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("全部");
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<{ search: string; key: number } | null>(null);
  const locationKeyRef = useRef(0);
  const handledLocationRef = useRef<string | null>(null);
  const pushedAnnouncementRef = useRef<string | null>(null);
  const refreshLocationState = () => setLocationState({ search: window.location.search, key: ++locationKeyRef.current });
  useEffect(() => { const stale = needsAcademicYearConfirmation(localStorage, CURRENT_ACADEMIC_YEAR); const saved = readSavedIdentity(localStorage, CURRENT_ACADEMIC_YEAR); setNewAcademicYear(stale); setIdentity(saved); setViewMode(saved === "全部" ? "all" : "related"); }, []);
  useEffect(() => { let active = true; readPublicAnnouncements().then(items => { if (active) setAnnouncements(items); }).catch(() => { if (active) setAnnouncementsError(true); }).finally(() => { if (active) setAnnouncementsLoading(false); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!selected) return;
    const announcementId = selected.id;
    const cached = loadedFollowUps[announcementId];
    if (cached) {
      setSelected(current => current?.id === announcementId ? { ...current, followUps: mergeAnnouncementFollowUps(current.followUps, cached) } : current);
      return;
    }
    let active = true;
    readAnnouncementFollowUps(announcementId).then(followUps => {
      if (!active) return;
      setLoadedFollowUps(current => ({ ...current, [announcementId]: followUps }));
      setSelected(current => current?.id === announcementId ? { ...current, followUps: mergeAnnouncementFollowUps(current.followUps, followUps) } : current);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selected?.id, loadedFollowUps]);
  useEffect(() => {
    refreshLocationState();
    const onPopState = () => refreshLocationState();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (!locationState || !identity || announcementsLoading || announcementsError) return;
    const handledKey = `${locationState.key}|${identity}|${viewMode}`;
    if (handledLocationRef.current === handledKey) return;
    handledLocationRef.current = handledKey;
    const announcementId = readAnnouncementIdFromSearch(locationState.search);
    if (!announcementId) {
      pushedAnnouncementRef.current = null;
      setSelected(null);
      return;
    }
    const result = resolveAnnouncementDeepLink(announcements, announcementId, identity, viewMode);
    if (result.status === "open") {
      setDeepLinkNotice(null);
      setSelected(current => current?.id === result.announcement.id ? current : result.announcement);
      return;
    }
    setSelected(null);
    setDeepLinkNotice(result.message);
    if (result.status === "not-found") {
      window.history.replaceState(null, "", withAnnouncementQuery(window.location.href, null));
      refreshLocationState();
    }
  }, [locationState, identity, viewMode, announcementsLoading, announcementsError, announcements]);
  const syncAnnouncementUrl = (announcementId: string) => {
    const current = readAnnouncementIdFromSearch(window.location.search);
    if (current === announcementId) return;
    const url = withAnnouncementQuery(window.location.href, announcementId);
    if (current) window.history.replaceState(null, "", url);
    else {
      window.history.pushState(null, "", url);
      pushedAnnouncementRef.current = announcementId;
    }
    refreshLocationState();
  };
  const openAnnouncement = (announcement: Announcement, source: AnnouncementOpenSource) => {
    void trackAnnouncementOpen(announcement.id, source);
    setDeepLinkNotice(null);
    setSelected(announcement);
    syncAnnouncementUrl(announcement.id);
  };
  const closeAnnouncement = () => {
    setSelected(null);
    const current = readAnnouncementIdFromSearch(window.location.search);
    if (!current) return;
    if (pushedAnnouncementRef.current === current) {
      pushedAnnouncementRef.current = null;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", withAnnouncementQuery(window.location.href, null));
    refreshLocationState();
  };
  const chooseIdentity = (value: SavedIdentity) => { saveIdentity(localStorage, value, CURRENT_ACADEMIC_YEAR); setIdentity(value); setNewAcademicYear(false); setViewMode(value === "全部" ? "all" : "related"); setSwitchingIdentity(false); setQuery(""); };
  const currentYearAnnouncements = useMemo(() => announcementsForAcademicYear(announcements, CURRENT_ACADEMIC_YEAR), [announcements]);
  const homepageAnnouncements = useMemo(() => viewMode === "all" || !identity || identity === "全部" ? currentYearAnnouncements : announcementsForIdentity(currentYearAnnouncements, identity as UserIdentity), [currentYearAnnouncements, identity, viewMode]);
  const searchYearAnnouncements = useMemo(() => announcementsForAcademicYear(announcements, searchAcademicYear), [announcements, searchAcademicYear]);
  const scopedSearchAnnouncements = useMemo(() => viewMode === "all" || !identity || identity === "全部" ? searchYearAnnouncements : announcementsForIdentity(searchYearAnnouncements, identity as UserIdentity), [identity, searchYearAnnouncements, viewMode]);
  const chasing = useMemo(() => chasingAnnouncements(homepageAnnouncements), [homepageAnnouncements]);
  const regularHomepageAnnouncements = useMemo(() => homepageAnnouncements.filter(item => item.collectionStatus !== "chasing"), [homepageAnnouncements]);
  const events = useMemo(() => weeklyEvents(regularHomepageAnnouncements, now), [regularHomepageAnnouncements, now]);
  const nextEvents = useMemo(() => nextWeekEvents(regularHomepageAnnouncements, now), [regularHomepageAnnouncements, now]);
  const groupedEvents = useMemo(() => Object.groupBy(events, item => item.date), [events]);
  const deadlines = useMemo(() => upcomingDeadlines(regularHomepageAnnouncements, now), [regularHomepageAnnouncements, now]);
  const importantNotices = useMemo(() => importantNoticeAnnouncements(homepageAnnouncements, now, [
    ...chasing.map(item => item.id),
    ...events.map(item => item.announcement.id),
    ...nextEvents.map(item => item.announcement.id),
    ...deadlines.map(item => item.announcement.id),
  ]), [homepageAnnouncements, now, chasing, events, nextEvents, deadlines]);
  const [importantExpanded, setImportantExpanded] = useState(false);
  const importantView = visibleImportantNotices(importantNotices, importantExpanded);
  // 公告視窗：已通過原有公告篩選後，才依目前身分與檢視模式篩選圖片；PDF 照舊全部顯示。
  const dialogImageStatuses = useMemo(() => new Map<string, ImageAudienceStatus>(selected ? visibleImagesFor(selected, identity, viewMode).map(row => [row.image.id, row.status]) : []), [selected, identity, viewMode]);
  const dialogAttachments = selected ? selected.attachments.filter(attachment => attachment.type === "pdf" || dialogImageStatuses.has(attachment.id)) : [];
  const showImageAudienceLabels = viewMode === "all" || identity === "全部";
  const rangeLabel = (bounds: { start: Date; end: Date }) => `${fmtDate(calendarDateKey(bounds.start))}～${fmtDate(calendarDateKey(bounds.end))}`;
  const weekRange = useMemo(() => rangeLabel(weekBounds(now)), [now]);
  const nextWeekRange = useMemo(() => rangeLabel(nextWeekBounds(now)), [now]);
  const results = useMemo(() => filterAnnouncements(scopedSearchAnnouncements, query, "全部", department), [scopedSearchAnnouncements, query, department]);

  if (identity === undefined) return <main className="identity-screen" aria-busy="true" />;
  if (identity === null) return <><main className="identity-screen"><section className="identity-card"><div className="welcome-mark">義</div><p className="eyebrow-dark">{CURRENT_ACADEMIC_YEAR} 學年度 · 校內公務公告</p><h1>義學公務資訊站</h1><p className="welcome-copy">{newAcademicYear ? "新的學年度開始，請確認您本學年度的身分" : "快速找到與你相關的重要資訊"}</p><h2>請選擇您的身分</h2><IdentityChoices onChoose={chooseIdentity} /><p className="privacy-note">不需要登入，也不會要求姓名或帳號；本站僅彙整匿名使用統計，可隨時由「統計與隱私設定」退出。</p></section></main><AnalyticsConsent /></>;
  return <><main>
    <header className="site-header"><div className="header-inner"><img className="brand-mark" src="/ysjh-info/icons/icon-192.png" alt="" aria-hidden="true" /><div className="brand-copy"><p className="eyebrow">校內公務公告</p><h1>義學公務資訊站</h1><HomeScreenInstall /></div><div className="date-stamp"><span>今天</span><strong>{fmtDate(taipeiDateKey(now))}</strong></div><Link className="admin-entry" href="/admin"><Settings aria-hidden="true" />行政管理</Link></div></header>
    <div className="identity-toolbar"><span>{CURRENT_ACADEMIC_YEAR} 學年度 · 目前身分：<strong>{identity === "全部" ? "查看全部" : identity}</strong></span><div><button onClick={() => setSwitchingIdentity(true)}>切換身分</button>{viewMode === "related" ? <button className="mode-button" onClick={() => { setViewMode("all"); setQuery(""); }}>查看全部公告</button> : identity !== "全部" && <button className="mode-button active" onClick={() => { setViewMode("related"); setQuery(""); }}>返回與我相關</button>}</div></div>
    <div className="page-shell">
      <HomeScreenInstall variant="banner" />
      {deepLinkNotice && <section className="announcement-state deeplink-notice" role="status"><p>{deepLinkNotice}</p><button type="button" onClick={() => setDeepLinkNotice(null)}>知道了</button></section>}
      {announcementsLoading ? <section className="announcement-state" aria-live="polite">公告載入中…</section> : announcementsError ? <section className="announcement-state error-state" role="alert">目前無法載入公告，請稍後再試。</section> : announcements.length === 0 ? <section className="announcement-state">目前沒有公告。</section> : <>
      {chasing.length > 0 && <section className="section chase-section" aria-labelledby="chase-title"><div className="section-heading"><div><p className="section-kicker">COLLECTION REMINDER</p><h2 id="chase-title">🚨 催繳中</h2></div></div><div className="announcement-list">{chasing.map(item => <article className="announcement-card chase-card" key={item.id}><span className="chase-badge">催繳中</span><h3 className="titled-with-level"><NoticeLevelBadge announcement={item} />{item.title}</h3>{item.deadlines.map((deadline, index) => <p key={index}>{deadlineDateLabel(deadline.date)} {deadline.time || ""}</p>)}{item.collectionMessage && <p>{item.collectionMessage}</p>}<DepartmentBadge department={item.department} /><button className="text-button" onClick={() => openAnnouncement(item, "chasing")}>查看完整公告 <ChevronRight aria-hidden="true" /></button></article>)}</div></section>}
      {importantView.total > 0 && <section className="section important-section" aria-labelledby="important-title"><div className="section-heading"><div><p className="section-kicker">MUST READ</p><h2 id="important-title">📣 重要公告・請留意</h2></div><span className="count">共 {importantView.total} 則</span></div><div className="announcement-list" id="important-notice-list">{importantView.visible.map(item => { const level = resolveLineNotificationLevel(item.lineNotificationLevel); return <article className={`announcement-card important-card important-${level}`} key={item.id}><div className="announcement-meta"><span>{fmtPublished(item.publishedAt)}</span><DepartmentBadge department={item.department} /></div><h3 className="titled-with-level"><NoticeLevelBadge announcement={item} />{item.title}</h3><AudienceTags values={item.audiences} /><AnnouncementUpdateBadges announcement={item} /><button className="text-button" onClick={() => openAnnouncement(item, "important")}>查看完整公告 <ChevronRight aria-hidden="true" /></button></article>; })}</div>{importantView.canExpand && <button type="button" className="important-toggle" aria-expanded={importantExpanded} aria-controls="important-notice-list" onClick={() => setImportantExpanded(value => !value)}>{importantExpanded ? "收合重要公告" : `查看全部重要公告（${importantView.total}）`}</button>}</section>}
      <section className={`section section-primary priority-section priority-weekly ${events.length === 0 ? "weekly-empty" : ""}`} aria-labelledby="weekly-title"><div className="section-heading"><div><p className="section-kicker">WEEKLY FOCUS</p><h2 id="weekly-title">📌 本週重要事項</h2></div><span className="range">{weekRange}</span></div>{events.length === 0 ? <p className="weekly-empty-message">本週暫無其他重要事項</p> : <div className="event-board">
        {Object.entries(groupedEvents).map(([date, items]) => {
          const days = daysUntil(date, now);
          const groupDisplay = weeklyEventDisplay(items![0], now);
          return <div className={`event-day ${days === 0 ? "today" : days === 1 ? "tomorrow" : ""}`} key={date}>
            <div className="day-label"><strong>{groupDisplay.dateLabel}</strong>{groupDisplay.contextLabel && <small>{groupDisplay.contextLabel}</small>}</div>
            <div className="day-events">{items!.map(item => {
              const action = primaryLink(item.announcement);
              const display = weeklyEventDisplay(item, now);
              return <div className="event-row" key={`${item.announcement.id}-${item.date}-${item.time}-${item.title}`}><button className="event-main" onClick={() => openAnnouncement(item.announcement, "weekly")}><time>{item.time || "全天"}</time><span className="event-copy"><NoticeLevelBadge announcement={item.announcement} /><strong>{item.title}</strong>{display.periodLabel && <small className="event-period">{display.periodLabel}</small>}<DepartmentAudienceMeta department={item.announcement.department} audiences={item.announcement.audiences} /><AnnouncementUpdateBadges announcement={item.announcement} className="announcement-badges event-update-badges" /></span><ChevronRight aria-hidden="true" /></button>{action && <a className="primary-action" href={action.url} target="_blank" rel="noopener noreferrer">開啟 {action.label}</a>}</div>;
            })}</div>
          </div>;
        })}
      </div>}</section>
      <section className={`section priority-section priority-next ${nextEvents.length === 0 ? "weekly-empty" : ""}`} aria-labelledby="next-week-title"><div className="section-heading"><div><p className="section-kicker">NEXT WEEK</p><h2 id="next-week-title">🗓️ 下週預告</h2></div><span className="range">{nextWeekRange}</span></div>{nextEvents.length === 0 ? <p className="weekly-empty-message">下週暫無預告事項</p> : <div className="event-board">{nextEvents.map(item => <div className="event-row" key={`${item.announcement.id}-${item.date}-${item.time}-${item.title}`}><button className="event-main" onClick={() => openAnnouncement(item.announcement, "next_week")}><time>{importantEventDateLabel(item.date, now)}</time><span className="event-copy"><NoticeLevelBadge announcement={item.announcement} /><strong>{item.title}</strong><DepartmentAudienceMeta department={item.announcement.department} audiences={item.announcement.audiences} /></span><ChevronRight aria-hidden="true" /></button></div>)}</div>}</section>
      <section className="section priority-section priority-deadline" aria-labelledby="deadline-title"><div className="section-heading"><div><p className="section-kicker">UPCOMING</p><h2 id="deadline-title">⏰ 即將截止</h2></div></div><div className="deadline-grid">{deadlines.map(({ announcement, deadline }) => { const action = primaryLink(announcement); const latestFollowUp = activeOriginalFollowUps(announcement.followUps).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; return <article className={`deadline-card urgency-${deadlineUrgency(deadline.date, now)}`} key={`${announcement.id}-${deadline.date}-${deadline.time}-${deadline.label}`}><button className="deadline-main" onClick={() => openAnnouncement(announcement, "deadline")}><div className="deadline-labels"><span className="deadline-status">{deadlineRelativeLabel(deadline.date, now)}</span><span className="deadline-date">{deadlineDateLabel(deadline.date)}</span></div><strong>{deadline.label}</strong><span className="deadline-time"><Clock3 aria-hidden="true" />{deadline.time || "當日截止"}</span><DepartmentAudienceMeta department={announcement.department} audiences={announcement.audiences} />{latestFollowUp && <span className="followup-badge">⚠ 有{formatLatestFollowUpLabel(latestFollowUp.type)}</span>}</button>{action && <a className="primary-action" href={action.url} target="_blank" rel="noopener noreferrer">前往 {action.label}</a>}</article>})}</div></section>
      <section className="section" aria-labelledby="latest-title"><div className="section-heading"><div><p className="section-kicker">LATEST</p><h2 id="latest-title">📢 最新公告</h2></div><span className="count">{homepageAnnouncements.length} 則</span></div><div className="announcement-list">{homepageAnnouncements.slice(0, 4).map(a => <article className="announcement-card" key={a.id}><div className="announcement-meta"><span>{fmtPublished(a.publishedAt)}</span><DepartmentBadge department={a.department} /></div><h3 className="titled-with-level"><NoticeLevelBadge announcement={a} />{a.title}</h3><AudienceTags values={a.audiences} /><AnnouncementUpdateBadges announcement={a} /><button className="text-button" onClick={() => openAnnouncement(a, "latest")}>查看完整公告 <ChevronRight aria-hidden="true" /></button></article>)}</div></section>
      <section className="section search-section" aria-labelledby="search-title"><div className="section-heading"><div><p className="section-kicker">ARCHIVE</p><h2 id="search-title">🔍 搜尋與篩選</h2></div><span className="scope-label">{viewMode === "all" ? "搜尋全部公告" : "搜尋與我相關"}</span></div><div className="year-switch" aria-label="學年度篩選">{FRONTEND_ACADEMIC_YEARS.map(year => <button key={year} className={searchAcademicYear === year ? "active" : ""} onClick={() => { setSearchAcademicYear(year); setQuery(""); }}>{year}學年度</button>)}</div><div className="filters"><label className="search-box"><span className="sr-only">搜尋公告</span><Search aria-hidden="true" /><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋標題、內容或發布單位" /></label><div className="select-row single"><label><span>發布單位</span><select value={department} onChange={event => setDepartment(event.target.value)}><option value="全部">全部發布單位</option><DepartmentOptionGroups /></select></label></div></div><p className="result-count">{searchAcademicYear} 學年度 · 找到 {results.length} 則公告</p><div className="results-list">{results.map(a => <button key={a.id} className="result-row" onClick={() => openAnnouncement(a, "search")}><span><small className="result-meta"><span>{a.academicYear} 學年度 · {fmtPublished(a.publishedAt)}</span><DepartmentBadge department={a.department} /></small><strong className="titled-with-level"><NoticeLevelBadge announcement={a} />{a.title}</strong><em>{a.audiences.join("、")}</em></span><ChevronRight aria-hidden="true" /></button>)}</div></section>
      </>}
    </div><footer>義學國中 · 公務資訊查詢原型 <span aria-hidden="true">·</span> <Link href="/admin">公務資訊發布</Link><small>Made by WenYi</small></footer>
    <Dialog open={!!selected} onOpenChange={open => !open && closeAnnouncement()}><DialogContent className="detail-dialog">{selected && <><DialogHeader><DialogDescription>{selected.department} · {fmtPublished(selected.publishedAt)} 發布{selected.contentUpdatedAt && <><br /><span>🔄 {fmtPublished(selected.contentUpdatedAt)} 更新</span></>}</DialogDescription><DialogTitle className="titled-with-level"><NoticeLevelBadge announcement={selected} />{selected.title}</DialogTitle><AudienceTags values={selected.audiences} /></DialogHeader>{(selected.importantEvents.length > 0 || selected.deadlines.length > 0) && <div className="detail-dates">{selected.importantEvents.length > 0 && <div><h4><CalendarDays />重要日期／活動</h4>{selected.importantEvents.map((event, i) => <p key={i}><strong>{formatImportantEventSchedule(event, fmtDate)}</strong><span>{event.title}</span></p>)}</div>}{selected.deadlines.length > 0 && <div className="deadline-detail"><h4><BellRing />繳交／填報期限</h4>{selected.deadlines.map((deadline, i) => <p key={i}><strong>{fmtDate(deadline.date)} {deadline.time}</strong><span>{deadline.label}</span></p>)}</div>}</div>}<div className="detail-content"><h4>公告內容</h4><p>{selected.content}</p></div><PublicAnnouncementFollowUps announcement={selected} formatDateTime={fmtPublished} />{relatedFollowUps(selected).length > 0 && <section className="followup-panel related-followups"><h4>💬 其他單位補充（{relatedFollowUps(selected).length}）</h4><div className="followup-history">{relatedFollowUps(selected).map((item, i) => <article className="related-followup-card" key={item.id ?? i}><div className="related-followup-meta"><DepartmentBadge department={item.department ?? "其他單位"} /><time>{fmtPublished(item.createdAt)}</time>{item.updatedAt && <small>🔄 已編輯</small>}</div><p>{item.message}</p></article>)}</div></section>}<AnnouncementContactLine contact={selected.contact} className="announcement-contact" />{dialogAttachments.length > 0 && <section className="attachment-section"><h4><ImageIcon />公告圖片／附件</h4><div className="attachment-grid">{dialogAttachments.map(attachment => attachment.type === "image" ? <figure key={attachment.id}><button onClick={() => setPreviewAttachment(attachment)} aria-label={`放大查看 ${attachment.name}`}><AnnouncementImage attachment={attachment} /><span><ZoomIn />放大查看</span></button><figcaption><strong className="attachment-name" title={attachment.name}>{attachment.name}</strong>{attachment.caption && <span>{attachment.caption}</span>}{showImageAudienceLabels && dialogImageStatuses.get(attachment.id)?.kind !== "shared" && <span className={`image-audience-label ${dialogImageStatuses.get(attachment.id)?.kind === "invalid" ? "invalid" : ""}`}>適用身分：{formatImageAudienceLabel(dialogImageStatuses.get(attachment.id)!)}</span>}</figcaption></figure> : <PdfAttachmentCard key={attachment.id} attachment={attachment} />)}</div></section>}{selected.links.length > 0 && <section className="links-section"><h4>🔗 相關連結</h4><div>{selected.links.map(link => <article key={link.id} className={link.isPrimary ? "primary" : ""}><strong>{link.label}</strong>{link.isPrimary && <span>主要連結</span>}<a href={link.url} target="_blank" rel="noopener noreferrer">開啟連結 ↗</a></article>)}</div></section>}</>}</DialogContent></Dialog>
    <Dialog open={!!previewAttachment} onOpenChange={open => !open && setPreviewAttachment(null)}><DialogContent className="image-dialog">{previewAttachment && <><DialogHeader><DialogTitle>{previewAttachment.name}</DialogTitle>{previewAttachment.caption && <DialogDescription>{previewAttachment.caption}</DialogDescription>}</DialogHeader><AnnouncementImage attachment={previewAttachment} /></>}</DialogContent></Dialog>
    <Dialog open={switchingIdentity} onOpenChange={setSwitchingIdentity}><DialogContent className="identity-dialog"><DialogHeader><DialogTitle>切換身分</DialogTitle><DialogDescription>首頁會立即改為顯示與新身分相關的資訊。</DialogDescription></DialogHeader><IdentityChoices onChoose={chooseIdentity} /></DialogContent></Dialog>
  </main><AnalyticsConsent /></>;
}
