"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type AnalyticsConsent,
  readAnalyticsConsent,
  writeAnalyticsConsent,
} from "@/lib/analyticsConsent";
import { disablePublicAnalytics, enablePublicAnalytics } from "@/lib/publicAnalytics";

type ConsentState = AnalyticsConsent | null | undefined;

const privacySummary = "經您同意後，本站會使用 Google Analytics 彙整頁面瀏覽與公告開啟情形，以改善資訊呈現；不傳送姓名、Email、Firebase UID、教師身分選項、公告標題、公告內容或搜尋文字。";

export function AnalyticsConsent() {
  const [consent, setConsent] = useState<ConsentState>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const savedConsent = readAnalyticsConsent(window.localStorage);
    queueMicrotask(() => { if (active) setConsent(savedConsent); });
    if (savedConsent === "granted") void enablePublicAnalytics();
    return () => { active = false; };
  }, []);

  const chooseConsent = (nextConsent: AnalyticsConsent) => {
    writeAnalyticsConsent(window.localStorage, nextConsent);
    setConsent(nextConsent);
    setSettingsOpen(false);
    if (nextConsent === "granted") void enablePublicAnalytics();
    else disablePublicAnalytics();
  };

  if (consent === undefined) return null;

  return <>
    {consent === null && <aside className="analytics-consent-banner" aria-label="網站統計偏好">
      <div>
        <strong>網站使用統計</strong>
        <p>{privacySummary} 不同意不影響網站功能，之後也可隨時變更。</p>
      </div>
      <div className="analytics-consent-actions">
        <button className="analytics-consent-accept" onClick={() => chooseConsent("granted")}>同意統計</button>
        <button onClick={() => chooseConsent("denied")}>暫不同意</button>
      </div>
    </aside>}

    {consent !== null && <button className="analytics-preferences-button" onClick={() => setSettingsOpen(true)}>統計與隱私設定</button>}

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="analytics-settings-dialog">
        <DialogHeader>
          <DialogTitle>網站統計與隱私</DialogTitle>
          <DialogDescription>{privacySummary}</DialogDescription>
        </DialogHeader>
        <p className="analytics-consent-status" aria-live="polite">
          目前狀態：<strong>{consent === "granted" ? "已同意統計" : "未啟用統計"}</strong>
        </p>
        <p className="analytics-consent-detail">GA4 的使用者與訪客數是依瀏覽器、裝置及模型估算，不代表實際教師人數。撤回後會停止後續追蹤，並嘗試清除本站可存取的 Analytics cookies。</p>
        <div className="analytics-consent-actions">
          {consent === "granted"
            ? <button className="analytics-consent-withdraw" onClick={() => chooseConsent("denied")}>撤回同意並停止統計</button>
            : <button className="analytics-consent-accept" onClick={() => chooseConsent("granted")}>同意啟用統計</button>}
          <button onClick={() => setSettingsOpen(false)}>關閉</button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
