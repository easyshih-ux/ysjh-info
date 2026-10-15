import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  createUsageStatisticsCache,
  getAdminUsageStatisticsHandler,
  getTaipeiDateRange,
  queryGa4UsageStatistics,
  type RunReport,
  type RunReportRequest,
} from "../src/adminUsageStatistics.ts";

type Profile = { enabled: boolean; role: string };

function createFirestore(profiles: Record<string, Profile>) {
  return {
    collection(name: string) {
      assert.equal(name, "authorizedPublishers");
      return {
        doc(uid: string) {
          return {
            async get() {
              const profile = profiles[uid];
              return {
                exists: profile !== undefined,
                data: () => profile,
              };
            },
          };
        },
      };
    },
  } as unknown as Firestore;
}

const request = (uid = "admin", data: unknown = {}) => ({ auth: uid ? { uid } : null, data });

async function rejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, error => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

function createRunReport() {
  const requests: RunReportRequest[] = [];
  const runReport: RunReport = async value => {
    requests.push(structuredClone(value));
    if (value.dimensions?.[0]?.name === "date") {
      return { rows: [
        { dimensionValues: [{ value: "20261008" }], metricValues: [{ value: "3" }, { value: "8" }] },
        { dimensionValues: [{ value: "20261010" }], metricValues: [{ value: "5" }, { value: "13" }] },
        { dimensionValues: [{ value: "invalid" }], metricValues: [{ value: "999" }, { value: "999" }] },
      ] };
    }
    if (value.dimensionFilter) return { rows: [{ metricValues: [{ value: "17" }] }] };
    if (value.metrics.length === 1) return { rows: [{ metricValues: [{ value: "42" }] }] };
    return { rows: [{ metricValues: [{ value: "9" }, { value: "24" }] }] };
  };
  return { requests, runReport };
}

test("Asia/Taipei 日期範圍固定為包含今日的七個日曆日", () => {
  assert.deepEqual(getTaipeiDateRange(new Date("2026-10-14T16:30:00.000Z")), {
    startDate: "2026-10-09",
    endDate: "2026-10-15",
    days: [
      "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12",
      "2026-10-13", "2026-10-14", "2026-10-15",
    ],
  });
});

test("GA4 使用四個獨立查詢且七日訪客不從每日數字加總", async () => {
  const reporter = createRunReport();
  const result = await queryGa4UsageStatistics(
    reporter.runReport,
    new Date("2026-10-14T10:00:00.000Z"),
  );

  assert.equal(reporter.requests.length, 4);
  assert.deepEqual(result.today, { activeUsers: 9, screenPageViews: 24 });
  assert.equal(result.last7Days.activeUsers, 42);
  assert.equal(result.last7Days.announcementOpens, 17);
  assert.equal(result.trend.length, 7);
  assert.deepEqual(result.trend[0], { date: "2026-10-08", activeUsers: 3, screenPageViews: 8 });
  assert.deepEqual(result.trend[1], { date: "2026-10-09", activeUsers: 0, screenPageViews: 0 });

  const sevenDayVisitors = reporter.requests.find(value => (
    value.metrics.length === 1 && value.metrics[0].name === "activeUsers"
  ));
  assert.ok(sevenDayVisitors);
  assert.equal(sevenDayVisitors.dimensions, undefined);
  assert.deepEqual(sevenDayVisitors.dateRanges, [{ startDate: "2026-10-08", endDate: "2026-10-14" }]);

  const eventQuery = reporter.requests.find(value => value.dimensionFilter);
  assert.equal(eventQuery?.dimensionFilter?.filter.fieldName, "eventName");
  assert.equal(eventQuery?.dimensionFilter?.filter.stringFilter.value, "announcement_open");
});

test("未登入、publisher、停用或不存在的管理員均無法查詢 GA4", async () => {
  const firestore = createFirestore({
    publisher: { enabled: true, role: "publisher" },
    disabled: { enabled: false, role: "systemAdmin" },
  });
  let queryCount = 0;
  const runReport: RunReport = async () => { queryCount += 1; return {}; };

  await rejectsWithCode(getAdminUsageStatisticsHandler(request(""), { firestore, runReport }), "unauthenticated");
  await rejectsWithCode(getAdminUsageStatisticsHandler(request("publisher"), { firestore, runReport }), "permission-denied");
  await rejectsWithCode(getAdminUsageStatisticsHandler(request("disabled"), { firestore, runReport }), "permission-denied");
  await rejectsWithCode(getAdminUsageStatisticsHandler(request("missing"), { firestore, runReport }), "permission-denied");
  assert.equal(queryCount, 0);
});

test("Callable 只接受空 payload", async () => {
  await rejectsWithCode(
    getAdminUsageStatisticsHandler(request("admin", { propertyId: "other" }), {
      firestore: createFirestore({ admin: { enabled: true, role: "systemAdmin" } }),
      runReport: async () => ({}),
    }),
    "invalid-argument",
  );
});

test("五分鐘快取在權限檢查後共用，逾期才重新查詢", async () => {
  const firestore = createFirestore({
    admin: { enabled: true, role: "systemAdmin" },
    secondAdmin: { enabled: true, role: "systemAdmin" },
    publisher: { enabled: true, role: "publisher" },
  });
  const reporter = createRunReport();
  const cache = createUsageStatisticsCache();
  let now = new Date("2026-10-14T10:00:00.000Z");
  const dependencies = { firestore, runReport: reporter.runReport, cache, now: () => now };

  const first = await getAdminUsageStatisticsHandler(request("admin"), dependencies);
  assert.equal(first.cached, false);
  assert.equal(reporter.requests.length, 4);

  await rejectsWithCode(
    getAdminUsageStatisticsHandler(request("publisher"), dependencies),
    "permission-denied",
  );
  assert.equal(reporter.requests.length, 4);

  now = new Date("2026-10-14T10:04:59.000Z");
  const cached = await getAdminUsageStatisticsHandler(request("secondAdmin"), dependencies);
  assert.equal(cached.cached, true);
  assert.equal(reporter.requests.length, 4);

  now = new Date("2026-10-14T10:05:00.000Z");
  const refreshed = await getAdminUsageStatisticsHandler(request("admin"), dependencies);
  assert.equal(refreshed.cached, false);
  assert.equal(reporter.requests.length, 8);
});

test("同時查詢會共用進行中的 GA4 請求", async () => {
  const firestore = createFirestore({
    admin: { enabled: true, role: "systemAdmin" },
    secondAdmin: { enabled: true, role: "systemAdmin" },
  });
  const cache = createUsageStatisticsCache();
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let queryCount = 0;
  const runReport: RunReport = async () => {
    queryCount += 1;
    await gate;
    return {};
  };
  const dependencies = { firestore, runReport, cache };

  const first = getAdminUsageStatisticsHandler(request("admin"), dependencies);
  await Promise.resolve();
  const second = getAdminUsageStatisticsHandler(request("secondAdmin"), dependencies);
  await Promise.resolve();
  release?.();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(queryCount, 4);
  assert.equal(firstResult.cached, false);
  assert.equal(secondResult.cached, true);
});

test("GA4 失敗轉為 unavailable 且不留下失敗快取", async () => {
  const firestore = createFirestore({ admin: { enabled: true, role: "systemAdmin" } });
  const cache = createUsageStatisticsCache();
  let shouldFail = true;
  const runReport: RunReport = async () => {
    if (shouldFail) throw new Error("simulated API failure");
    return {};
  };

  await rejectsWithCode(
    getAdminUsageStatisticsHandler(request(), { firestore, runReport, cache }),
    "unavailable",
  );
  assert.equal(cache.entry, null);
  assert.equal(cache.pending, null);

  shouldFail = false;
  const recovered = await getAdminUsageStatisticsHandler(request(), { firestore, runReport, cache });
  assert.equal(recovered.cached, false);
});
