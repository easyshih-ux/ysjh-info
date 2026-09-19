import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AdminAuthGuard } from "@/components/admin-auth-guard";
import styles from "./manage-nav.module.css";

export default function ManageLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminAuthGuard><nav className={styles.nav} aria-label="管理頁導覽"><Link href="/admin"><ArrowLeft />返回發布工作台</Link></nav>{children}</AdminAuthGuard>;
}
