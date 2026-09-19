"use client";

import { useEffect, useState } from "react";
import {
  listPendingPublisherRequests,
  type PendingPublisherRequest,
} from "@/lib/publisherRequestManagement";

export type PublisherRequestsState =
  | { status: "loading"; requests: [] }
  | { status: "ready"; requests: PendingPublisherRequest[] }
  | { status: "error"; requests: [] };

export function usePublisherRequests(enabled: boolean): PublisherRequestsState {
  const [state, setState] = useState<PublisherRequestsState>({ status: "loading", requests: [] });

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    setState({ status: "loading", requests: [] });
    listPendingPublisherRequests()
      .then(requests => {
        if (active) setState({ status: "ready", requests });
      })
      .catch(() => {
        if (active) setState({ status: "error", requests: [] });
      });

    return () => { active = false; };
  }, [enabled]);

  return state;
}
