"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { browserLocalStorage, getInstallGuidance, INSTALL_STEPS, INSTALLED_DISPLAY_MODES, isStandaloneDisplay, readInstallBannerDismissed, writeInstallBannerDismissed, type InstallGuidance } from "@/lib/pwaInstall";
import { copyOfficialPublicSiteUrl, OFFICIAL_PUBLIC_SITE_URL } from "@/lib/siteUrl";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Navigator { standalone?: boolean }
}

/**
 * 安裝入口：variant="pill" 為頁首小按鈕（不受「不再提醒」影響）；
 * variant="banner" 為首頁橫幅（可「不再提醒」，保存在本瀏覽器的 localStorage，不寫入 Firebase）。
 * 兩者都只在從瀏覽器開啟時顯示；安裝說明只在使用者點擊後出現，不主動跳出。
 */
export function HomeScreenInstall({ variant = "pill" }: { variant?: "pill" | "banner" }) {
  const [visible, setVisible] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [guidance, setGuidance] = useState<InstallGuidance | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "success" | "failure">("idle");

  useEffect(() => {
    const installedDisplay = INSTALLED_DISPLAY_MODES.some(mode => window.matchMedia(`(display-mode: ${mode})`).matches);
    if (isStandaloneDisplay(installedDisplay, navigator.standalone)) return;
    if (variant === "banner" && readInstallBannerDismissed(browserLocalStorage())) return;
    let active = true;
    queueMicrotask(() => { if (active) setVisible(true); });
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installed = () => {
      setVisible(false);
      setGuidance(null);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, [variant]);

  if (!visible) return null;

  const requestInstall = async () => {
    const environment = getInstallGuidance(navigator.userAgent, navigator.maxTouchPoints);
    if (environment === "line") {
      setGuidance("line");
      return;
    }
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
      } catch {
        setGuidance(environment);
      }
      return;
    }
    setGuidance(environment);
  };

  const closeGuidance = () => {
    setGuidance(null);
    setCopyStatus("idle");
  };

  const copySiteUrl = async () => {
    setCopyStatus("copying");
    const copied = await copyOfficialPublicSiteUrl();
    setCopyStatus(copied ? "success" : "failure");
  };

  // 保存失敗（無痕模式等）時仍在本次瀏覽中隱藏。
  const dismissBanner = () => {
    writeInstallBannerDismissed(browserLocalStorage());
    setVisible(false);
  };

  const steps = guidance && guidance !== "line" ? INSTALL_STEPS[guidance] : null;

  return <>
    {variant === "banner"
      ? <section className="install-banner" aria-labelledby="install-banner-title">
        <div><h2 id="install-banner-title">📲 把義學公務資訊站放到桌面！</h2><p>像 APP 一樣快速開啟，不用再翻 LINE 找網址。</p></div>
        <div className="install-banner-actions"><button type="button" className="install-banner-primary" onClick={requestInstall}>立即安裝／查看步驟</button><button type="button" className="install-banner-dismiss" onClick={dismissBanner}>不再提醒</button></div>
      </section>
      : <button type="button" className="install-entry" onClick={requestInstall}><Download aria-hidden="true" />安裝義學公務</button>}
    <Dialog open={guidance !== null} onOpenChange={open => !open && closeGuidance()}>
      <DialogContent className="install-dialog">
        <DialogHeader>
          <DialogTitle>安裝義學公務</DialogTitle>
          <DialogDescription>
            {guidance === "line"
              ? <>LINE 內建瀏覽器無法安裝義學公務。<br />請點 LINE 畫面右上角的選單（⋮ 或分享圖示），選擇用瀏覽器開啟；也可以複製下方網址，貼到 Chrome 或 Safari 開啟後再安裝。</>
              : steps ? `${steps.title}：依下列步驟操作即可。` : null}
          </DialogDescription>
        </DialogHeader>
        {steps && <div className="install-steps"><ol>{steps.steps.map(step => <li key={step}>{step}</li>)}</ol>{steps.note && <p>{steps.note}</p>}<DialogClose asChild><button type="button" className="install-dialog-close" onClick={closeGuidance}>關閉</button></DialogClose></div>}
        {guidance === "line" && <div className="install-line-actions">
          <code>{OFFICIAL_PUBLIC_SITE_URL}</code>
          {copyStatus === "success" && <p role="status">✓ 網址已複製！請開啟 Chrome 或 Safari貼上即可。</p>}
          {copyStatus === "failure" && <p role="alert">無法自動複製，請長按上方網址手動複製。</p>}
          <div>
            <button type="button" onClick={copySiteUrl} disabled={copyStatus === "copying"}>{copyStatus === "copying" ? "正在複製…" : "複製網站網址"}</button>
            <DialogClose asChild><button type="button" className="install-dialog-close" onClick={closeGuidance}>關閉</button></DialogClose>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
