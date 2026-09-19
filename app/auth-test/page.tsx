"use client";

import { missingFirebaseConfigKeys } from "@/lib/firebaseClient";
import { getEmailDomain, isExpectedSchoolEmail } from "@/lib/schoolAuth";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import styles from "./auth-test.module.css";

export default function AuthTestPage() {
  const { status, user, errorCode, busy, login, logout } = useFirebaseAuth();

  return <main className={styles.page}><section className={styles.card}>
    <p className={styles.kicker}>Firebase Authentication Prototype</p>
    <h1>學校 Google 帳號登入測試</h1>
    <p className={styles.intro}>僅驗證 Google 登入與登入狀態恢復，不會取得公務資訊發布權限。</p>

    {status === "checking" && <div className={styles.status} role="status"><span className={styles.spinner} />正在確認登入狀態…</div>}

    {status === "configuration-missing" && <div className={styles.setup} role="status"><h2>程式結構已準備完成</h2><p>尚未提供 Firebase Web App configuration，因此登入按鈕暫不啟用。</p><p>缺少設定：{missingFirebaseConfigKeys.join("、")}</p></div>}

    {status === "signed-out" && <div className={styles.status}><strong>尚未登入</strong><button type="button" onClick={login} disabled={busy}>{busy ? "正在開啟 Google 登入…" : "使用學校 Google 帳號登入"}</button></div>}

    {status === "signed-in" && user && <div className={styles.signedIn}><div className={styles.success}>登入成功</div><dl><div><dt>Email</dt><dd>{user.email || "Google 帳號未提供 Email"}</dd></div><div><dt>Email domain</dt><dd>{getEmailDomain(user.email) || "無法判斷"}</dd></div><div><dt>預計測試的學校網域</dt><dd>{isExpectedSchoolEmail(user.email) ? "是" : "否"}</dd></div></dl><p>網域結果僅供本次測試，不代表正式發布授權。</p><button type="button" className={styles.secondary} onClick={logout} disabled={busy}>{busy ? "正在登出…" : "登出測試帳號"}</button></div>}

    {errorCode && <div className={styles.error} role="alert"><strong>Firebase Auth 錯誤</strong><code>{errorCode}</code><span>未顯示 token 或敏感憑證。</span></div>}
  </section></main>;
}
