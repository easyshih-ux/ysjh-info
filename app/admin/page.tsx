import Link from "next/link";
import { ArrowLeft, ChevronRight, FilePenLine, FilePlus2 } from "lucide-react";
import styles from "./admin.module.css";

export default function AdminPage() {
  return <main className={styles.page}>
    <section className={styles.panel}>
      <Link className={styles.back} href="/"><ArrowLeft />返回公務資訊站</Link>
      <p className={styles.kicker}>發布端 Prototype</p>
      <h1>公務資訊發布</h1>
      <p className={styles.intro}>選擇要進行的工作。</p>
      <aside className={styles.notice}>目前未設登入或權限驗證，僅供操作流程驗證。</aside>
      <nav className={styles.actions} aria-label="發布工作台功能">
        <Link href="/publish"><FilePlus2 /><span><strong>＋ 發布新公告</strong><small>新增需要留存、查詢或提醒的重要公務資訊</small></span><ChevronRight /></Link>
        <Link href="/manage"><FilePenLine /><span><strong>管理已發布公告</strong><small>修正公告、補登資訊或新增稽催</small></span><ChevronRight /></Link>
      </nav>
    </section>
  </main>;
}
