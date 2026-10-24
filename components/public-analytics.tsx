"use client";

import { useEffect } from "react";
import { enablePublicAnalytics, isPublicAnalyticsAllowed } from "@/lib/publicAnalytics";

/**
 * 公開首頁的 GA4 啟動器：不顯示任何畫面，只在允許統計時啟動 GA4，供管理者儀表板使用。
 * 不提供前台退出或重新啟用；既有的退出偏好與瀏覽器 GPC 設定仍會被尊重（不載入 GA4）。
 */
export function PublicAnalytics() {
  useEffect(() => {
    if (isPublicAnalyticsAllowed()) void enablePublicAnalytics();
  }, []);
  return null;
}
