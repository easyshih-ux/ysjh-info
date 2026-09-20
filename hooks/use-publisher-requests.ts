"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listPublisherManagement,
  type ManagedPublisher,
  type PendingPublisherRequest,
} from "@/lib/publisherRequestManagement";

export type PublisherRequestsState =
  | { status: "loading"; requests: []; publishers: [] }
  | { status: "ready"; requests: PendingPublisherRequest[]; publishers: ManagedPublisher[] }
  | { status: "error"; requests: []; publishers: [] };

export function usePublisherRequests(enabled: boolean) {
  const [state, setState] = useState<PublisherRequestsState>({ status: "loading", requests: [], publishers: [] });

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setState({ status: "loading", requests: [], publishers: [] });
    try {
      setState({ status: "ready", ...await listPublisherManagement() });
    } catch {
      setState({ status: "error", requests: [], publishers: [] });
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
