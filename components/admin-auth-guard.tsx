"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getAuthorizedPublisher, type ValidAuthorizedPublisher } from "@/lib/authorizedPublishers";
import { missingFirebaseConfigKeys } from "@/lib/firebaseClient";
import { useFirebaseAuth } from "@/hooks/use-firebase-auth";
import styles from "./admin-auth-guard.module.css";

const AuthorizedPublisherContext = createContext<ValidAuthorizedPublisher | null>(null);

export function AdminAuthGuard({ children }: { children: ReactNode }) {
  const { status, user, errorCode, busy, login, logout } = useFirebaseAuth();

  if (status === "checking") {
    return <AuthShell><div className={styles.status} role="status"><span className={styles.spinner} />正在確認發布者身分…</div></AuthShell>;
  }

  if (status === "configuration-missing") {
    return <AuthShell><div className={styles.warning} role="alert"><h2>Firebase Auth 尚未設定</h2><p>缺少設定：{missingFirebaseConfigKeys.join("、")}</p></div></AuthShell>;
  }

  if (status === "signed-out" || !user) {
    return <AuthShell>
      <div className={styles.status}>
        <p>行政發布功能僅供授權發布者使用。</p>
        <button type="button" onClick={login} disabled={busy}>{busy ? "正在開啟 Google 登入…" : "使用學校 Google 帳號登入"}</button>
      </div>
      <AuthError errorCode={errorCode} />
    </AuthShell>;
  }

  const publisher = getAuthorizedPublisher(user.email);
  if (!publisher) {
    return <AuthShell>
      <div className={styles.denied} role="alert">
        <h2>此帳號尚未取得公務資訊發布權限</h2>
        <p>目前帳號</p>
        <strong>{user.email || "Google 帳號未提供 Email"}</strong>
        <div className={styles.actions}>
          <button type="button" onClick={login} disabled={busy}>切換帳號</button>
          <button type="button" className={styles.secondary} onClick={logout} disabled={busy}>登出帳號</button>
        </div>
      </div>
      <AuthError errorCode={errorCode} />
    </AuthShell>;
  }

  return <AuthorizedPublisherContext.Provider value={publisher}>
    <div className={styles.authenticatedArea}>
      <div className={styles.accountBar} aria-label="目前登入身分">
        <span>{user.email}</span>
        <span className={styles.divider} aria-hidden="true">｜</span>
        <button type="button" onClick={logout} disabled={busy}>{busy ? "正在登出…" : "登出"}</button>
      </div>
      {children}
    </div>
  </AuthorizedPublisherContext.Provider>;
}

export function useAuthorizedPublisher() {
  const publisher = useContext(AuthorizedPublisherContext);
  if (!publisher) throw new Error("useAuthorizedPublisher must be used inside AdminAuthGuard");
  return publisher;
}

function AuthShell({ children }: { children: ReactNode }) {
  return <main className={styles.page}><section className={styles.card}>
    <p className={styles.kicker}>行政發布端</p>
    <h1>義學公務資訊發布</h1>
    {children}
  </section></main>;
}

function AuthError({ errorCode }: { errorCode: string }) {
  if (!errorCode) return null;
  return <div className={styles.error} role="alert"><strong>Firebase Auth 錯誤</strong><code>{errorCode}</code></div>;
}
