"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getInstallGuidance, isStandaloneDisplay, type InstallGuidance } from "@/lib/pwaInstall";

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

  return <>
    <button type="button" className="install-entry" onClick={requestInstall}><Download aria-hidden="true" />安裝到主畫面</button>
    <Dialog open={guidance !== null} onOpenChange={open => !open && setGuidance(null)}>
      <DialogContent className="install-dialog">
        <DialogHeader>
          <DialogTitle>安裝到主畫面</DialogTitle>
          <DialogDescription>
            {guidance === "line"
              ? "LINE 內建瀏覽器無法安裝本網站，請改用 Chrome 或 Safari 開啟。"
              : guidance === "safari"
                ? "請點選 Safari 的「分享」，再選擇「加入主畫面」。"
                : "請開啟瀏覽器選單，選擇「安裝應用程式」或「新增至主畫面」。"}
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  </>;
}
