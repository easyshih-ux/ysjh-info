"use client";

import { useEffect, useState } from "react";
import {
  readPublisherProfile,
  type PublisherProfileReadResult,
} from "@/lib/publisherProfile";

export type PublisherProfileState =
  | { status: "idle" }
  | { status: "loading"; uid: string }
  | (PublisherProfileReadResult & { uid: string });

export function usePublisherProfile(uid: string | null | undefined): PublisherProfileState {
  const [state, setState] = useState<PublisherProfileState>({ status: "idle" });

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
  }, [uid]);

  if (!uid) return { status: "idle" };
  if (!("uid" in state) || state.uid !== uid) return { status: "loading", uid };
  return state;
}
