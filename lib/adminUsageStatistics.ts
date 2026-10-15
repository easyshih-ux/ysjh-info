import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseApp } from "./firebaseClient.ts";

export interface DailyUsageStatistics {
  date: string;
  activeUsers: number;
  screenPageViews: number;
}

export interface AdminUsageStatistics {
  today: {
    activeUsers: number;
    screenPageViews: number;
  };
  last7Days: {
    activeUsers: number;
    announcementOpens: number;
  };
  trend: DailyUsageStatistics[];
  dateRange: {
    startDate: string;
    endDate: string;
    timeZone: "Asia/Taipei";
  };
  updatedAt: string;
  cacheTtlSeconds: 300;
  cached: boolean;
  delayNotice: string;
}

export async function fetchAdminUsageStatistics(): Promise<AdminUsageStatistics> {
  const functions = getFunctions(getFirebaseApp(), "asia-east1");
  const callable = httpsCallable<Record<string, never>, AdminUsageStatistics>(
    functions,
    "getAdminUsageStatistics",
  );
  const result = await callable({});
  return result.data;
}
