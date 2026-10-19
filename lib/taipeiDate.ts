export const TAIPEI_TIME_ZONE = "Asia/Taipei";

const TAIPEI_UTC_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TAIPEI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function taipeiDateKey(value: Date) {
  const parts = taipeiDateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function parseCalendarDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function calendarDateKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function formatCalendarDate(value: string) {
  const date = parseCalendarDate(value);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"];
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}（${weekday[date.getUTCDay()]}）`;
}

export function millisecondsUntilNextTaipeiMidnight(now: Date) {
  const today = parseCalendarDate(taipeiDateKey(now));
  const nextMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1) - TAIPEI_UTC_OFFSET_MILLISECONDS;
  return Math.max(0, nextMidnight - now.getTime());
}

interface RefreshEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface VisibilityEventTarget extends RefreshEventTarget {
  visibilityState: string;
}

interface TaipeiDateRefreshOptions {
  onNow: (now: Date) => void;
  now?: () => Date;
  windowTarget?: RefreshEventTarget;
  documentTarget?: VisibilityEventTarget;
  setTimeoutFn?: (callback: () => void, delay: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

const MIDNIGHT_TIMER_BUFFER_MILLISECONDS = 250;

export function startTaipeiDateAutoRefresh(options: TaipeiDateRefreshOptions) {
  const getNow = options.now ?? (() => new Date());
  const windowTarget = options.windowTarget ?? (window as unknown as RefreshEventTarget);
  const documentTarget = options.documentTarget ?? (document as unknown as VisibilityEventTarget);
  const setTimer = options.setTimeoutFn ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const clearTimer = options.clearTimeoutFn ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let stopped = false;

  const schedule = (current: Date) => {
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(recalibrate, millisecondsUntilNextTaipeiMidnight(current) + MIDNIGHT_TIMER_BUFFER_MILLISECONDS);
  };
  const recalibrate = () => {
    if (stopped) return;
    const current = getNow();
    options.onNow(current);
    schedule(current);
  };
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") recalibrate();
  };

  windowTarget.addEventListener("focus", recalibrate);
  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  recalibrate();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimer(timer);
    windowTarget.removeEventListener("focus", recalibrate);
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
