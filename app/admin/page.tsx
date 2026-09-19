"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, FilePenLine, FilePlus2, Home, Users } from "lucide-react";
import { AdminAuthGuard, useAuthorizedPublisher } from "@/components/admin-auth-guard";
import styles from "./admin.module.css";

export default function AdminPage() {
  return <AdminAuthGuard><AdminDashboard /></AdminAuthGuard>;
}

function AdminDashboard() {
  const publisher = useAuthorizedPublisher();

  return <main className={styles.page}>
    <section className={styles.panel}>
      <Link className={styles.back} href="/"><ArrowLeft />返回公務資訊站</Link>
      <p className={styles.kicker}>ADMINISTRATION</p>
      <h1>行政管理</h1>
      <p className={styles.intro}>選擇要進行的公務資訊工作。</p>
      <nav className={styles.actions} aria-label="行政管理功能">
        <Link href="/publish"><FilePlus2 /><span><strong>＋ 發布新公告</strong><small>新增需要留存、查詢或提醒的重要公務資訊</small></span><ChevronRight /></Link>
        <Link href="/manage"><FilePenLine /><span><strong>管理已發布公告</strong><small>修正公告、補登資訊或新增稽催</small></span><ChevronRight /></Link>
        {publisher.role === "systemAdmin" && <Link href="/admin/publishers"><Users /><span><strong>發布者管理</strong><small>查看待核准的發布權限申請</small></span><ChevronRight /></Link>}
        <Link href="/"><Home /><span><strong>查看義學公務資訊站</strong><small>返回老師查看公告的公開資訊站</small></span><ChevronRight /></Link>
      </nav>
    </section>
  </main>;
}
