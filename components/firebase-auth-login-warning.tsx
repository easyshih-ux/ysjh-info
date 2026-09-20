"use client";

import { useState } from "react";
import { copyOfficialPublicSiteUrl, OFFICIAL_PUBLIC_SITE_URL } from "@/lib/siteUrl";
import styles from "./admin-auth-guard.module.css";

type CopyStatus = "idle" | "copying" | "success" | "failure";

export function FirebaseAuthLoginWarning({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  if (!open) return null;

  const copySiteUrl = async () => {
    setCopyStatus("copying");
    const copied = await copyOfficialPublicSiteUrl();
    setCopyStatus(copied ? "success" : "failure");
  };

  const close = () => {
    setCopyStatus("idle");
    onClose();
  };

  return <div className={styles.warning} role="dialog" aria-modal="true" aria-labelledby="google-login-warning-title">
    <div>
      <h2 id="google-login-warning-title">請使用瀏覽器登入</h2>
      <p>LINE 內建瀏覽器可能無法正常完成 Google 登入。<br />請複製網站網址，使用 Chrome 或 Safari 開啟後，再進行行政登入。</p>
      {copyStatus === "success" && <p role="status">✓ 網址已複製，請貼到 Chrome 或 Safari 開啟</p>}
      {copyStatus === "failure" && <div role="alert">
        <p>無法自動複製，請手動複製下方網址：</p>
        <code>{OFFICIAL_PUBLIC_SITE_URL}</code>
      </div>}
      <div className={styles.actions}>
        <button type="button" onClick={copySiteUrl} disabled={copyStatus === "copying"}>
          {copyStatus === "copying" ? "正在複製…" : "複製網站網址"}
        </button>
        <button type="button" className={styles.secondary} onClick={close}>關閉</button>
      </div>
    </div>
  </div>;
}
