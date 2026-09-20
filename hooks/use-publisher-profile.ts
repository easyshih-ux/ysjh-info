"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readPublisherProfile,
  type PublisherProfileReadResult,
} from "@/lib/publisherProfile";

export type PublisherProfileState =
  | { status: "idle" }
  | { status: "loading"; uid: string }
  | (PublisherProfileReadResult & { uid: string });

export type PublisherProfileHookState = PublisherProfileState & { refresh: () => void };

export function usePublisherProfile(uid: string | null | undefined): PublisherProfileHookState {
  const [state, setState] = useState<PublisherProfileState>({ status: "idle" });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!uid) {
      setState({ status: "idle" });
      return;
    }

    let active = true;
    setState({ status: "loading", uid });
    readPublisherProfile(uid).then(result => {
      if (active) setState({ ...result, uid });
    });

    return () => {
      active = false;
    };
  }, [uid, revision]);

  if (!uid) return { status: "idle", refresh };
  if (!("uid" in state) || state.uid !== uid) return { status: "loading", uid, refresh };
  return { ...state, refresh };
}
