"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type AnalyticsConsent,
  readAnalyticsConsent,
  shouldEnableAnalytics,
  writeAnalyticsConsent,
} from "@/lib/analyticsConsent";
import { disablePublicAnalytics, enablePublicAnalytics } from "@/lib/publicAnalytics";

type ConsentState = AnalyticsConsent | null | undefined;

const privacySummary = "本站使用 Google Analytics 彙整頁面瀏覽與公告開啟情形，以改善行政資訊推廣；不傳送姓名、Email、Firebase UID、教師身分選項、公告標題、公告內容或搜尋文字。";

export function AnalyticsConsent() {
  const [consent, setConsent] = useState<ConsentState>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const savedConsent = readAnalyticsConsent(window.localStorage);
    queueMicrotask(() => { if (active) setConsent(savedConsent); });
    if (shouldEnableAnalytics(savedConsent)) void enablePublicAnalytics();
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
    <button className="analytics-preferences-button" onClick={() => setSettingsOpen(true)}>統計與隱私設定</button>

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="analytics-settings-dialog">
        <DialogHeader>
          <DialogTitle>網站統計與隱私</DialogTitle>
          <DialogDescription>{privacySummary}</DialogDescription>
        </DialogHeader>
        <p className="analytics-consent-status" aria-live="polite">
          目前狀態：<strong>{consent === "denied" ? "已退出統計" : "已啟用匿名統計"}</strong>
        </p>
        <p className="analytics-consent-detail">GA4 的使用者與訪客數是依瀏覽器、裝置及模型估算，不代表實際教師人數。您可隨時退出；退出後會停止後續追蹤，並清除本站可存取的 Analytics cookies。</p>
        <div className="analytics-consent-actions">
          {consent === "denied"
            ? <button className="analytics-consent-accept" onClick={() => chooseConsent("granted")}>重新啟用統計</button>
            : <button className="analytics-consent-withdraw" onClick={() => chooseConsent("denied")}>退出統計並停止後續追蹤</button>}
          <button onClick={() => setSettingsOpen(false)}>關閉</button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
