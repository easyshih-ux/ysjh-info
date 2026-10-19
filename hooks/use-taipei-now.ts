"use client";

import { useEffect, useState } from "react";
import { startTaipeiDateAutoRefresh, taipeiDateKey } from "@/lib/taipeiDate";

export function useTaipeiNow() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => startTaipeiDateAutoRefresh({
    onNow: current => setNow(previous => taipeiDateKey(previous) === taipeiDateKey(current) ? previous : current),
  }), []);

  return now;
}
