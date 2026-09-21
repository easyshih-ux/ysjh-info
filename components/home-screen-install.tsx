"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getInstallGuidance, isStandaloneDisplay, type InstallGuidance } from "@/lib/pwaInstall";
import { copyOfficialPublicSiteUrl, OFFICIAL_PUBLIC_SITE_URL } from "@/lib/siteUrl";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Navigator { standalone?: boolean }
}

export function HomeScreenInstall() {
  const [visible, setVisible] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [guidance, setGuidance] = useState<InstallGuidance | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "success" | "failure">("idle");

  useEffect(() => {
    if (isStandaloneDisplay(window.matchMedia("(display-mode: standalone)").matches, navigator.standalone)) return;
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
  }, []);

  if (!visible) return null;

  const requestInstall = async () => {
    const environment = getInstallGuidance(navigator.userAgent);
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
        setGuidance("browser");
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

  return <>
    <button type="button" className="install-entry" onClick={requestInstall}><Download aria-hidden="true" />安裝義學公務</button>
    <Dialog open={guidance !== null} onOpenChange={open => !open && closeGuidance()}>
      <DialogContent className="install-dialog">
        <DialogHeader>
          <DialogTitle>安裝義學公務</DialogTitle>
          <DialogDescription>
            {guidance === "line"
              ? <>LINE 無法直接安裝義學公務。<br />請使用 Chrome 或 Safari 開啟網站後再安裝。</>
              : guidance === "safari"
                ? "點擊 Safari 的分享按鈕，再選擇『加入主畫面』。"
                : "請開啟瀏覽器選單，選擇「安裝應用程式」或「新增至主畫面」。"}
          </DialogDescription>
        </DialogHeader>
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
