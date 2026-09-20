"use client";

import styles from "./admin-auth-guard.module.css";

export function FirebaseAuthLoginWarning({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return <div className={styles.warning} role="dialog" aria-modal="true" aria-labelledby="google-login-warning-title">
    <div>
      <h2 id="google-login-warning-title">請使用瀏覽器登入</h2>
      <p>LINE 內建瀏覽器可能無法正常完成 Google 登入。<br />請使用 Chrome 或 Safari 開啟本網站後，再進行行政登入。</p>
      <div className={styles.actions}>
        <button type="button" onClick={onClose}>關閉</button>
      </div>
    </div>
  </div>;
}
