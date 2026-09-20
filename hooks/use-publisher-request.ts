"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createPublisherRequest,
  readPublisherRequest,
  type PublisherRequestReadResult,
} from "@/lib/publisherRequest";

export type PublisherRequestState =
  | { status: "idle"; submitting: false }
  | { status: "loading"; uid: string; submitting: false }
  | (PublisherRequestReadResult & { uid: string; submitting: boolean });

export function usePublisherRequest({
  uid,
  email,
  displayName,
  enabled,
}: {
  uid: string | null | undefined;
  email: string | null | undefined;
  displayName: string | null | undefined;
  enabled: boolean;
}) {
  const [state, setState] = useState<PublisherRequestState>({ status: "idle", submitting: false });

  useEffect(() => {
    if (!uid || !enabled) {
      setState({ status: "idle", submitting: false });
      return;
    }

    let active = true;
    setState({ status: "loading", uid, submitting: false });
    readPublisherRequest(uid).then(result => {
      if (active) setState({ ...result, uid, submitting: false });
    });
    return () => { active = false; };
  }, [enabled, uid]);

  const submit = useCallback(async (requestedDepartment: string) => {
    if (!uid || !email || !enabled || state.submitting || state.status !== "not-found") return;

    setState({ status: "not-found", uid, submitting: true });
    try {
      await createPublisherRequest({ uid, email, displayName: displayName ?? null, requestedDepartment });
      setState({ status: "pending", uid, submitting: false });
    } catch {
      setState({ status: "error", uid, submitting: false });
    }
  }, [displayName, email, enabled, state.status, state.submitting, uid]);

  if (!uid || !enabled) return { status: "idle", submitting: false, submit } as const;
  if (!("uid" in state) || state.uid !== uid) {
    return { status: "loading", uid, submitting: false, submit } as const;
  }
  return { ...state, submit };
}
