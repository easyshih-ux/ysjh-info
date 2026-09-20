"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listPendingPublisherRequests,
  type PendingPublisherRequest,
} from "@/lib/publisherRequestManagement";

export type PublisherRequestsState =
  | { status: "loading"; requests: [] }
  | { status: "ready"; requests: PendingPublisherRequest[] }
  | { status: "error"; requests: [] };

export function usePublisherRequests(enabled: boolean) {
  const [state, setState] = useState<PublisherRequestsState>({ status: "loading", requests: [] });

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setState({ status: "loading", requests: [] });
    try {
      setState({ status: "ready", requests: await listPendingPublisherRequests() });
    } catch {
      setState({ status: "error", requests: [] });
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
