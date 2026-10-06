import type { Announcement, FollowUp } from "@/lib/announcements";
import { activeOriginalFollowUps, visibleWithdrawnFollowUps } from "@/lib/announcementWithdrawnFollowUps";

export function PublicAnnouncementFollowUps({ announcement, formatDateTime }: { announcement: Announcement; formatDateTime: (value: string) => string }) {
  const active = activeOriginalFollowUps(announcement.followUps);
  const reminders = active.filter(item => item.type === "reminder");
  const supplements = active.filter(item => item.type === "supplement");
  const withdrawn = visibleWithdrawnFollowUps(announcement.followUps);

  return <>
    {reminders.length > 0 && <section className="followup-panel"><h4>⚠ 提醒（{reminders.length}）</h4><time>{formatDateTime(reminders[0].createdAt)}</time><p>{reminders[0].message}</p>{reminders.length > 1 && <details><summary>查看過往提醒（{reminders.length - 1}）</summary><div className="followup-history">{reminders.slice(1).map((item, index) => <ActiveFollowUp key={item.id ?? index} item={item} formatDateTime={formatDateTime} />)}</div></details>}</section>}
    {supplements.length > 0 && <section className="followup-panel supplement-panel"><h4>📌 補充資訊（{supplements.length}）</h4><div className="followup-history">{supplements.map((item, index) => <ActiveFollowUp key={item.id ?? index} item={item} formatDateTime={formatDateTime} />)}</div></section>}
    {withdrawn.length > 0 && <section className="withdrawn-followups"><h4>已撤回紀錄</h4><div>{withdrawn.map((item, index) => <article key={item.id ?? `${item.createdAt}-${index}`}><p>此則{item.type === "supplement" ? "補充" : "提醒"}已由發布者撤回</p>{item.withdrawnAt && <time>{formatDateTime(item.withdrawnAt)}</time>}</article>)}</div></section>}
  </>;
}

function ActiveFollowUp({ item, formatDateTime }: { item: FollowUp; formatDateTime: (value: string) => string }) {
  return <article><time>{formatDateTime(item.createdAt)}</time><p>{item.message}</p></article>;
}
