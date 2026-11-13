import type { RetentionCleanupDecision } from "./retentionCleanup.js";

/**
 * 自動清理監控：唯讀狀態查詢的回傳格式（前後端共用）。
 * 本檔只能 import 純計算模組 retentionCleanup.ts 的型別，不得 import firebase-admin、firebase-functions，
 * 因為前端（Next.js 型別檢查，CI 只安裝根目錄套件）也會載入本檔。
 */
export const RETENTION_CLEANUP_SCHEDULE = { cron: "0 3 * * *", timeZone: "Asia/Taipei", label: "每天 03:00（臺灣時間）" } as const;

export interface RetentionStatusAnnouncement {
  id: string;
  title: string;
  department: string;
  publicationStatus: string;
  retentionPolicy: string | null;
  category: RetentionCleanupDecision["category"];
  basisDate: string | null;
  baseCleanupDate: string | null;
  latestUpdateDate: string | null;
  protectionDate: string | null;
  finalCleanupDate: string | null;
  eligible: boolean;
  skipReasons: string[];
}

export interface RetentionRunSummary {
  id: string;
  runDate: string | null;
  startedAt: string | null;
  startedAtTaipei: string | null;
  status: string | null;
  mode: string | null;
  /** Gate 5 起的整體結果（completed、stoppedAfterFailure…）；舊紀錄或缺少時為 null，前端不得推定為成功。 */
  result: string | null;
  scanned: number | null;
  eligible: number | null;
  skipped: number | null;
  deleted: number | null;
  failed: number | null;
  errorCount: number | null;
  results: { id: string; outcome: string; detail?: string }[];
}

export interface RetentionCleanupStatus {
  generatedAt: string;
  generatedAtTaipei: string;
  today: string;
  cached: boolean;
  refreshThrottled: boolean;
  nextRefreshAt: string;
  settings: { mode: "off" | "dryRun" | "live"; requestedMode: string; maxDeletesPerRun: number };
  schedule: typeof RETENTION_CLEANUP_SCHEDULE;
  summary: { scanned: number; eligible: number; skipped: number; skippedByReason: Partial<Record<string, number>>; wouldDeleteToday: string[]; deferredCount: number };
  announcements: RetentionStatusAnnouncement[];
  runs: RetentionRunSummary[];
  errors: string[];
}
