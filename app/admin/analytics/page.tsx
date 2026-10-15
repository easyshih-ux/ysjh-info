"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useAdminUsageStatistics } from "@/hooks/use-admin-usage-statistics";
import type { AdminUsageStatistics } from "@/lib/adminUsageStatistics";
import styles from "./analytics.module.css";

const chartConfig = {
  activeUsers: { label: "訪客估計數", color: "#1f5d86" },
  screenPageViews: { label: "頁面瀏覽次數", color: "#c58f2b" },
} satisfies ChartConfig;

export default function AdminAnalyticsPage() {
  return <AdminAuthGuard><AnalyticsAuthorization /></AdminAuthGuard>;
}

function AnalyticsAuthorization() {
  const publisher = useAuthorizedPublisher();
  if (publisher.role !== "systemAdmin") {
    return <main className={styles.page}><section className={styles.panel}>
      <Link className={styles.back} href="/admin"><ArrowLeft />返回行政管理</Link>
      <h1>網站使用統計</h1>
      <p className={styles.error} role="alert">此功能僅供系統管理員使用。</p>
    </section></main>;
  }
  return <AnalyticsDashboard />;
}

function AnalyticsDashboard() {
  const state = useAdminUsageStatistics();

  return <main className={styles.page}><section className={styles.panel}>
    <div className={styles.topRow}>
      <div>
        <Link className={styles.back} href="/admin"><ArrowLeft />返回行政管理</Link>
        <p className={styles.kicker}>WEBSITE ANALYTICS</p>
        <h1>網站使用統計</h1>
        <p className={styles.intro}>彙總呈現公開資訊站的使用趨勢，不包含個別教師閱讀紀錄。</p>
      </div>
      <button
        type="button"
        className={styles.refresh}
        onClick={() => void state.refresh()}
        disabled={state.status === "loading"}
      ><RefreshCw aria-hidden="true" />{state.status === "loading" ? "讀取中…" : "重新整理"}</button>
    </div>

    {state.status === "loading" && <div className={styles.status} role="status"><span className={styles.spinner} />正在讀取 GA4 彙總統計…</div>}
    {state.status === "error" && <div className={styles.error} role="alert">
      <strong>目前無法取得網站使用統計</strong>
      <span>原有行政功能不受影響，請稍後再試。</span>
      <button type="button" onClick={() => void state.refresh()}>重新嘗試</button>
    </div>}
    {state.status === "ready" && <StatisticsContent data={state.data} />}
  </section></main>;
}

function StatisticsContent({ data }: { data: AdminUsageStatistics }) {
  const cards = [
    { label: "今日訪客估計數", value: data.today.activeUsers, detail: "今日不重複活躍訪客估計" },
    { label: "今日網站瀏覽次數", value: data.today.screenPageViews, detail: "公開首頁 page_view 彙總" },
    { label: "近七日訪客估計數", value: data.last7Days.activeUsers, detail: "七日區間獨立去重，非每日加總" },
    { label: "近七日公告開啟次數", value: data.last7Days.announcementOpens, detail: "announcement_open 事件彙總" },
  ];
  const chartData = data.trend.map(item => ({ ...item, label: formatChartDate(item.date) }));

  return <>
    <section className={styles.cards} aria-label="網站使用統計摘要">
      {cards.map(card => <article key={card.label} className={styles.card}>
        <span>{card.label}</span>
        <strong>{card.value.toLocaleString("zh-TW")}</strong>
        <small>{card.detail}</small>
      </article>)}
    </section>

    <section className={styles.chartSection} aria-labelledby="usage-trend-title">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="usage-trend-title">最近七日每日使用趨勢</h2>
          <p>{formatDate(data.dateRange.startDate)}－{formatDate(data.dateRange.endDate)}（Asia/Taipei）</p>
        </div>
      </div>
      <ChartContainer config={chartConfig} className={styles.chart} initialDimension={{ width: 720, height: 320 }}>
        <LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} width={36} tickLine={false} axisLine={false} />
          <Tooltip formatter={(value, name) => [Number(value).toLocaleString("zh-TW"), chartConfig[name as keyof typeof chartConfig]?.label ?? name]} />
          <Legend formatter={value => chartConfig[value as keyof typeof chartConfig]?.label ?? value} />
          <Line type="monotone" dataKey="activeUsers" name="activeUsers" stroke="var(--color-activeUsers)" strokeWidth={3} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="screenPageViews" name="screenPageViews" stroke="var(--color-screenPageViews)" strokeWidth={3} dot={{ r: 3 }} />
        </LineChart>
      </ChartContainer>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>日期</th><th>訪客估計數</th><th>頁面瀏覽次數</th></tr></thead>
          <tbody>{data.trend.map(item => <tr key={item.date}>
            <th scope="row">{formatDate(item.date)}</th>
            <td>{item.activeUsers.toLocaleString("zh-TW")}</td>
            <td>{item.screenPageViews.toLocaleString("zh-TW")}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <footer className={styles.meta}>
      <p>統計更新時間：{formatUpdatedAt(data.updatedAt)}{data.cached ? "（使用五分鐘快取）" : ""}</p>
      <p>{data.delayNotice}</p>
    </footer>
  </>;
}

function formatChartDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}
