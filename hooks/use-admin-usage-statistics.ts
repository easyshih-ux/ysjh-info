"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminUsageStatistics,
  type AdminUsageStatistics,
} from "@/lib/adminUsageStatistics";

export type AdminUsageStatisticsState =
  | { status: "loading"; data: null }
  | { status: "ready"; data: AdminUsageStatistics }
  | { status: "error"; data: null };

export function useAdminUsageStatistics() {
  const [state, setState] = useState<AdminUsageStatisticsState>({ status: "loading", data: null });

  const refresh = useCallback(async () => {
    setState({ status: "loading", data: null });
    try {
      const data = await fetchAdminUsageStatistics();
      setState({ status: "ready", data });
    } catch {
      setState({ status: "error", data: null });
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchAdminUsageStatistics()
      .then(data => {
        if (active) setState({ status: "ready", data });
      })
      .catch(() => {
        if (active) setState({ status: "error", data: null });
      });
    return () => {
      active = false;
    };
  }, []);

  return { ...state, refresh };
}
