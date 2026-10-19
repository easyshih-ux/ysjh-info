import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startTaipeiDateAutoRefresh, taipeiDateKey } from "../lib/taipeiDate.ts";

class FakeEventTarget {
  visibilityState = "visible";
  listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

test("網頁持續開啟跨越臺灣午夜時重新校正並安排下一次 timer", () => {
  let current = new Date("2026-10-17T23:59:00+08:00");
  let timer: (() => void) | undefined;
  let delay = 0;
  const seen: string[] = [];
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  const stop = startTaipeiDateAutoRefresh({
    now: () => current,
    onNow: value => seen.push(taipeiDateKey(value)),
    windowTarget,
    documentTarget,
    setTimeoutFn: (callback, milliseconds) => { timer = callback; delay = milliseconds; return callback; },
    clearTimeoutFn: () => undefined,
  });

  assert.deepEqual(seen, ["2026-10-17"]);
  assert.equal(delay, 60_250);
  current = new Date("2026-10-18T00:01:00+08:00");
  timer?.();
  assert.deepEqual(seen, ["2026-10-17", "2026-10-18"]);
  assert.equal(delay, 86_340_250);
  stop();
});

test("背景分頁恢復、視窗 focus 與休眠跨日後都會重新校正", () => {
  let current = new Date("2026-10-18T08:00:00+08:00");
  const seen: string[] = [];
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  let clearCount = 0;
  const stop = startTaipeiDateAutoRefresh({
    now: () => current,
    onNow: value => seen.push(taipeiDateKey(value)),
    windowTarget,
    documentTarget,
    setTimeoutFn: callback => callback,
    clearTimeoutFn: () => { clearCount += 1; },
  });

  documentTarget.visibilityState = "hidden";
  documentTarget.dispatch("visibilitychange");
  assert.deepEqual(seen, ["2026-10-18"]);
  current = new Date("2026-10-19T08:00:00+08:00");
  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  current = new Date("2026-10-21T08:00:00+08:00");
  windowTarget.dispatch("focus");
  assert.deepEqual(seen, ["2026-10-18", "2026-10-19", "2026-10-21"]);

  stop();
  const seenBeforeCleanupEvents = seen.length;
  windowTarget.dispatch("focus");
  documentTarget.dispatch("visibilitychange");
  assert.equal(seen.length, seenBeforeCleanupEvents);
  assert.ok(clearCount >= 3);
  assert.equal(windowTarget.listeners.get("focus")?.size, 0);
  assert.equal(documentTarget.listeners.get("visibilitychange")?.size, 0);
});

test("首頁只更新日期 state，不新增 Firestore 輪詢或重複讀取", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../hooks/use-taipei-now.ts", import.meta.url), "utf8");
  assert.match(page, /const now = useTaipeiNow\(\)/);
  assert.doesNotMatch(page, /const \[now\] = useState\(\(\) => new Date\(\)\)/);
  assert.equal(page.match(/readPublicAnnouncements\(\)/g)?.length, 1);
  assert.doesNotMatch(page, /setInterval/);
  assert.match(hook, /taipeiDateKey\(previous\) === taipeiDateKey\(current\) \? previous : current/);
});
