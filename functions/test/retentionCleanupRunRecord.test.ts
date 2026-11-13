// 方案 C Gate 5：自動清理執行紀錄的單元測試（不需 Emulator）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { type RetentionCleanupReader } from "../src/retentionCleanupJob.ts";
import type { RetentionDeleter, RetentionDeletionOutcome } from "../src/retentionCleanupLive.ts";
import {
  buildRetentionCleanupCrashRecord, buildRetentionCleanupRunRecord, isAlreadyExistsError, summarizeRetentionCleanupError, recordRetentionCleanupRun, retentionRunIdFromStart, RETENTION_CLEANUP_RUNS_COLLECTION,
  RETENTION_RUN_RETENTION_DAYS, type RetentionCleanupRunRecord, type RetentionRunRecordWriter,
} from "../src/retentionCleanupRunRecord.ts";
import { runScheduledRetentionCleanup } from "../src/retentionCleanupSchedule.ts";
import { parseRunSummary, RETENTION_CLEANUP_RUNS_COLLECTION as STATUS_RUNS_COLLECTION } from "../src/retentionCleanupStatus.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const NOW = Date.parse("2027-01-19T19:00:05.123Z"); // 臺灣 2027-01-20 03:00:05
const FINISHED = NOW + 4_000;
const announcement = (overrides: Record<string, unknown> = {}) => ({
  academicYear: 115, publishedAt: "2026-08-01T02:00:00.000Z", department: "設備組", title: "機密標題", content: "機密內文",
  publicationStatus: "published", retentionPolicy: "autoCleanup", importantEvents: [], deadlines: [{ date: "2026-09-01", label: "繳交" }], ...overrides,
});
const reader = (settings: unknown, announcements: { id: string; data: unknown }[]): RetentionCleanupReader => ({
  readSettings: async () => settings, listAnnouncements: async () => announcements.map(item => ({ ...item })), readFollowUps: async () => [], readLineNotices: async () => [],
});
function deleter(behavior: (id: string) => RetentionDeletionOutcome | Error) {
  const calls: string[] = [];
  const value: RetentionDeleter = { deleteIfStillEligible: async id => { calls.push(id); const result = behavior(id); if (result instanceof Error) throw result; return result; } };
  return { deleter: value, calls };
}
/** 記憶體寫入器：模擬 Firestore create()（已存在即 ALREADY_EXISTS），並記錄所有呼叫。 */
function memoryWriter(options: { failCreate?: Error; initial?: Record<string, unknown> } = {}) {
  const docs = new Map<string, unknown>(Object.entries(options.initial ?? {}));
  const calls: string[] = [];
  const writer: RetentionRunRecordWriter = {
    create: async (id, record) => {
      calls.push(`create:${id}`);
      if (options.failCreate) throw options.failCreate;
      if (docs.has(id)) throw Object.assign(new Error("6 ALREADY_EXISTS: Document already exists"), { code: 6 });
      docs.set(id, structuredClone(record));
    },
    read: async id => { calls.push(`read:${id}`); return docs.get(id) ?? null; },
  };
  return { writer, docs, calls };
}
function memoryLogger() {
  const lines: { level: string; label: string; payload: string }[] = [];
  return { lines, logger: { log: (label: unknown, payload: unknown) => lines.push({ level: "log", label: String(label), payload: String(payload) }), error: (label: unknown, payload: unknown) => lines.push({ level: "error", label: String(label), payload: String(payload) }) } };
}
const due = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `due${String(index).padStart(2, "0")}`, data: announcement() }));
const run = (settings: unknown, announcements: { id: string; data: unknown }[], options: { del?: RetentionDeleter; writer?: RetentionRunRecordWriter; logger?: ReturnType<typeof memoryLogger>["logger"] } = {}) =>
  runScheduledRetentionCleanup({ reader: reader(settings, announcements), now: NOW, deleter: options.del, writer: options.writer ?? memoryWriter().writer, logger: options.logger ?? memoryLogger().logger, clock: () => FINISHED });
const onlyRecord = (docs: Map<string, unknown>) => { assert.equal(docs.size, 1, "每次執行只產生一筆紀錄"); return [...docs.values()][0] as RetentionCleanupRunRecord; };

test("G5-1 live 成功：寫入一筆摘要（runId、UTC／臺灣時間、計數、個別結果、90 天到期），且不含標題或內文", async () => {
  const store = memoryWriter();
  const { deleter: del } = deleter(id => ({ id, outcome: "deleted", finalCleanupDate: "2026-12-15" }));
  const { report, record } = await run({ mode: "live" }, [...due(2), { id: "keep", data: announcement({ retentionPolicy: "longTerm" }) }], { del, writer: store.writer });
  assert.deepEqual(record, { status: "written", documentId: "2027-01-19T19-00-05.123Z" });
  const saved = onlyRecord(store.docs);
  assert.equal(saved.runId, retentionRunIdFromStart(report.startedAt));
  assert.equal(saved.startedAtUtc, "2027-01-19T19:00:05.123Z");
  assert.equal(saved.startedAtTaipei, "2027-01-20 03:00:05 (Asia/Taipei)");
  assert.equal(saved.finishedAtUtc, new Date(FINISHED).toISOString());
  assert.equal(saved.runDate, "2027-01-20");
  assert.equal(saved.status, "live");
  assert.equal(saved.mode, "live");
  assert.equal(saved.result, "completed");
  assert.equal(saved.scanned, 3);
  assert.equal(saved.eligible, 2);
  assert.equal(saved.skipped, 1);
  assert.deepEqual(saved.skippedByReason, { retention_long_term: 1 });
  assert.deepEqual(saved.liveCounts, { deleted: 2, skippedAtClaim: 0, raceUnclaimed: 0, failed: 0, notAttempted: 0 });
  assert.deepEqual(saved.liveResults?.map(result => result.id), ["due00", "due01"]);
  assert.equal(saved.recordVersion, 1);
  assert.ok(saved.expiresAt instanceof Date);
  assert.equal(saved.expiresAt.getTime() - Date.parse(report.startedAt), RETENTION_RUN_RETENTION_DAYS * 86_400_000);
  const json = JSON.stringify(saved);
  assert.doesNotMatch(json, /機密標題|機密內文|"title"|"content"|"department"/, "不保存公告標題、內文或單位");
});

test("G5-2 dryRun：寫入紀錄但沒有刪除計數；不會呼叫刪除器", async () => {
  const store = memoryWriter();
  const { deleter: del, calls } = deleter(id => ({ id, outcome: "deleted", finalCleanupDate: null }));
  await run({ mode: "dryRun" }, due(2), { del, writer: store.writer });
  const saved = onlyRecord(store.docs);
  assert.equal(saved.status, "dryRun");
  assert.equal(saved.result, "completed");
  assert.equal(saved.eligible, 2);
  assert.deepEqual(saved.wouldDeleteToday.map(item => item.id), ["due00", "due01"]);
  assert.equal("liveCounts" in saved, false);
  assert.deepEqual(calls, [], "dryRun 不刪除");
});

test("G5-3 off（含缺少設定）：沿用既有語意不掃描，但仍記錄這次排程為 off", async () => {
  for (const settings of [{ mode: "off" }, null, { mode: "LIVE" }]) {
    const store = memoryWriter();
    const { deleter: del, calls } = deleter(id => ({ id, outcome: "deleted", finalCleanupDate: null }));
    const { report } = await run(settings, due(3), { del, writer: store.writer });
    const saved = onlyRecord(store.docs);
    assert.equal(report.scanned, 0, "off 不掃描");
    assert.equal(saved.status, "off");
    assert.equal(saved.result, "off");
    assert.equal(saved.scanned, 0);
    assert.deepEqual(calls, []);
  }
});

test("G5-4 沒有符合資格的公告時仍有紀錄（live 計數皆為 0）", async () => {
  const store = memoryWriter();
  const { deleter: del, calls } = deleter(id => ({ id, outcome: "deleted", finalCleanupDate: null }));
  await run({ mode: "live" }, [{ id: "future", data: announcement({ deadlines: [{ date: "2027-06-01", label: "x" }] }) }], { del, writer: store.writer });
  const saved = onlyRecord(store.docs);
  assert.equal(saved.result, "completed");
  assert.equal(saved.eligible, 0);
  assert.deepEqual(saved.liveCounts, { deleted: 0, skippedAtClaim: 0, raceUnclaimed: 0, failed: 0, notAttempted: 0 });
  assert.deepEqual(calls, []);
});

test("G5-5 部分刪除失敗：如實記錄成功、失敗與未處理數量，結果為 stoppedAfterFailure（不是成功）", async () => {
  const store = memoryWriter();
  const { deleter: del, calls } = deleter(id => id === "due01" ? { id, outcome: "failed", stage: "delete", message: "storage unavailable" } : { id, outcome: "deleted", finalCleanupDate: "2026-12-15" });
  await run({ mode: "live" }, due(4), { del, writer: store.writer });
  assert.deepEqual(calls, ["due00", "due01"], "失敗後停止（沿用既有保護）");
  const saved = onlyRecord(store.docs);
  assert.equal(saved.result, "stoppedAfterFailure");
  assert.deepEqual(saved.liveCounts, { deleted: 1, skippedAtClaim: 0, raceUnclaimed: 0, failed: 1, notAttempted: 2 });
  assert.deepEqual(saved.notAttempted, ["due02", "due03"]);
  assert.equal(saved.errorCount, 1);
  const parsed = parseRunSummary({ id: "x", data: saved });
  assert.equal(parsed.deleted, 1);
  assert.equal(parsed.failed, 1);
  assert.deepEqual(parsed.results.map(result => [result.id, result.outcome]), [["due00", "deleted"], ["due01", "failed"]]);
});

test("G5-6 紀錄寫入失敗：不拋出例外、清理結果不變、不會重新刪除，錯誤寫入 Cloud Logging", async () => {
  for (const failure of [new Error("PERMISSION_DENIED: missing"), Object.assign(new Error("deadline"), { code: 4 })]) {
    const store = memoryWriter({ failCreate: failure });
    const log = memoryLogger();
    const { deleter: del, calls } = deleter(id => ({ id, outcome: "deleted", finalCleanupDate: "2026-12-15" }));
    const { report, record } = await run({ mode: "live" }, due(2), { del, writer: store.writer, logger: log.logger });
    assert.equal(record.status, "failed");
    assert.deepEqual(calls, ["due00", "due01"], "每篇只處理一次");
    assert.deepEqual(report.liveResults.map(result => result.outcome), ["deleted", "deleted"], "已成功的刪除仍為成功");
    assert.equal(store.calls.filter(call => call.startsWith("create")).length, 1, "非重複錯誤不重試寫入");
    assert.equal(log.lines[0].label, "retention-cleanup-run", "清理摘要先寫入日誌");
    const failed = log.lines.find(line => line.level === "error");
    assert.equal(failed?.label, "retention-cleanup-run-record-failed");
    assert.match(failed?.payload ?? "", /2027-01-19T19-00-05\.123Z/);
  }
});

test("G5-7 重複寫入同一次執行 → duplicate 不覆蓋；不同執行同一 runId → 改用 -2，原紀錄不變", async () => {
  const store = memoryWriter();
  const log = memoryLogger();
  const { report } = await run({ mode: "dryRun" }, due(1), { writer: store.writer, logger: log.logger });
  const original = structuredClone(store.docs.get("2027-01-19T19-00-05.123Z"));
  assert.deepEqual(await recordRetentionCleanupRun(store.writer, report, FINISHED + 60_000, log.logger), { status: "duplicate", documentId: "2027-01-19T19-00-05.123Z" });
  assert.deepEqual(store.docs.get("2027-01-19T19-00-05.123Z"), original, "完成時間不同也不覆蓋");
  assert.equal(store.docs.size, 1);
  const different = { ...report, eligible: 0, wouldDeleteToday: [] };
  assert.deepEqual(await recordRetentionCleanupRun(store.writer, different, FINISHED, log.logger), { status: "written", documentId: "2027-01-19T19-00-05.123Z-2" });
  assert.deepEqual(store.docs.get("2027-01-19T19-00-05.123Z"), original);
  assert.equal(store.docs.size, 2);
  // 五個候選 ID 都被不同內容占用 → failed，不覆蓋任何一筆。
  const full = memoryWriter({ initial: Object.fromEntries(["", "-2", "-3", "-4", "-5"].map(suffix => [`2027-01-19T19-00-05.123Z${suffix}`, { contentHash: "other" }])) });
  const outcome = await recordRetentionCleanupRun(full.writer, report, FINISHED, log.logger);
  assert.equal(outcome.status, "failed");
  assert.equal(full.docs.get("2027-01-19T19-00-05.123Z").contentHash, "other");
});

test("G5-8 紀錄可被監控 callable 的 parseRunSummary 直接解析（與 Gate 2 相容）", () => {
  const report = { today: "2027-01-20", startedAt: "2027-01-19T19:00:05.123Z", status: "live" as const, mode: "live" as const, requestedMode: "live", maxDeletesPerRun: 20, scanned: 5, eligible: 1, wouldDeleteToday: [], deferred: [], skippedByReason: { not_yet_due: 4 }, decisions: [], liveResults: [{ id: "a", outcome: "skipped_at_claim" as const, reasons: ["line_notice_pending"] }], notAttempted: [], errors: [] };
  const record = buildRetentionCleanupRunRecord(report, FINISHED);
  const parsed = parseRunSummary({ id: record.runId, data: record });
  assert.deepEqual(parsed, {
    id: "2027-01-19T19-00-05.123Z", runDate: "2027-01-20", startedAt: "2027-01-19T19:00:05.123Z", startedAtTaipei: "2027-01-20 03:00:05 (Asia/Taipei)", status: "live", mode: "live", result: "completed",
    scanned: 5, eligible: 1, skipped: 4, deleted: 0, failed: 0, errorCount: 0, results: [{ id: "a", outcome: "skipped_at_claim", detail: "line_notice_pending" }],
  });
  assert.equal(RETENTION_CLEANUP_RUNS_COLLECTION, "retentionCleanupRuns");
  assert.equal(STATUS_RUNS_COLLECTION, RETENTION_CLEANUP_RUNS_COLLECTION, "讀寫同一集合");
});

test("G5-9 錯誤代碼判斷：只有 ALREADY_EXISTS 視為重複", () => {
  for (const error of [{ code: 6 }, { code: "already-exists" }, new Error("6 ALREADY_EXISTS: x")]) assert.equal(isAlreadyExistsError(error), true);
  for (const error of [{ code: 7 }, new Error("PERMISSION_DENIED"), null, "x"]) assert.equal(isAlreadyExistsError(error), false);
});

test("G5-10 原始碼：紀錄只用 create／get；排程先清理、再寫日誌、最後寫紀錄；清理邏輯檔案仍不含寫入", () => {
  // 雜湊計算的 createHash(...).update( 不是 Firestore 寫入，比對前排除該行。
  const recordSource = source("retentionCleanupRunRecord.ts").split("\n").filter(line => !/createHash\("sha256"\)\.update\(/.test(line)).join("\n");
  assert.match(recordSource, /runs\.doc\(documentId\)\.create\(record\)/);
  assert.doesNotMatch(recordSource, /\.set\(|\.update\(|\.delete\(|recursiveDelete|deleteFiles|runTransaction|\.batch\(|deleteIfStillEligible|createRetentionDeleter/);
  const schedule = source("retentionCleanupSchedule.ts");
  const body = schedule.slice(schedule.indexOf("export async function runScheduledRetentionCleanup"));
  const order = ["runRetentionCleanup(", 'logger.log("retention-cleanup-run"', "recordRetentionCleanupRun("].map(token => body.indexOf(token));
  assert.ok(order.every(index => index >= 0) && order[0] < order[1] && order[1] < order[2], "清理完成後才寫紀錄");
  assert.doesNotMatch(source("retentionCleanupJob.ts"), /retentionCleanupRunRecord|\.create\(/);
});

// ===== Gate 6A-1：清理函式直接拋出未預期例外 =====

/** 模擬程式錯誤：設定讀取正常（live），公告列表回傳非陣列，使 runRetentionCleanup 在錯誤處理之外拋出 TypeError。 */
const crashingReader = (): RetentionCleanupReader => ({ readSettings: async () => ({ mode: "live" }), listAnnouncements: async () => null as never, readFollowUps: async () => [], readLineNotices: async () => [] });
const crashRun = (writer: RetentionRunRecordWriter, logger: ReturnType<typeof memoryLogger>["logger"], del?: RetentionDeleter, clock: () => number = () => FINISHED) =>
  runScheduledRetentionCleanup({ reader: crashingReader(), now: NOW, deleter: del ?? deleter(id => ({ id, outcome: "deleted", finalCleanupDate: null })).deleter, writer, logger, clock });

test("G6A-1 清理直接拋出例外：寫入 Logging 與 result: failed 紀錄（數量為 null），並重新拋出「同一個」原始例外", async () => {
  const store = memoryWriter();
  const log = memoryLogger();
  const { deleter: del, calls } = deleter(id => ({ id, outcome: "deleted", finalCleanupDate: null }));
  let thrown: unknown;
  await crashRun(store.writer, log.logger, del).catch(error => { thrown = error; });
  assert.ok(thrown instanceof TypeError, "原始例外被重新拋出");
  assert.deepEqual(calls, [], "不會重新執行清理或刪除");
  assert.deepEqual(store.calls, ["create:2027-01-19T19-00-05.123Z"], "只嘗試寫入一次紀錄");
  const saved = onlyRecord(store.docs) as unknown as Record<string, unknown>;
  assert.equal(saved.result, "failed");
  assert.equal(saved.status, "failed");
  assert.equal(saved.crashed, true);
  for (const field of ["scanned", "eligible", "skipped", "deferredCount", "mode", "maxDeletesPerRun"]) assert.equal(saved[field], null, `${field} 必須為 null，不可為 0`);
  assert.equal("liveCounts" in saved, false);
  assert.equal("liveResults" in saved, false);
  assert.equal(saved.startedAtUtc, "2027-01-19T19:00:05.123Z");
  assert.equal(saved.startedAtTaipei, "2027-01-20 03:00:05 (Asia/Taipei)");
  assert.equal(saved.runDate, "2027-01-20");
  assert.equal(saved.errorCount, 1);
  assert.match(String((saved.errors as string[])[0]), /^TypeError: /);
  assert.ok(saved.expiresAt instanceof Date);
  assert.deepEqual(log.lines.map(line => `${line.level}:${line.label}`), ["error:retention-cleanup-run-crashed", "log:retention-cleanup-run-recorded"], "先寫入 Logging 錯誤；不會產生正常完成的摘要");
  const parsed = parseRunSummary({ id: "2027-01-19T19-00-05.123Z", data: saved });
  assert.deepEqual({ result: parsed.result, scanned: parsed.scanned, eligible: parsed.eligible, skipped: parsed.skipped, deleted: parsed.deleted, failed: parsed.failed, errorCount: parsed.errorCount, results: parsed.results },
    { result: "failed", scanned: null, eligible: null, skipped: null, deleted: null, failed: null, errorCount: 1, results: [] }, "監控 callable 解析後仍為 null，不會變成 0");
});

test("G6A-2 例外後紀錄寫入也失敗：留下 Logging 錯誤，但拋出的仍是原始例外（不被掩蓋）", async () => {
  for (const writerFailure of [new Error("14 UNAVAILABLE: firestore down"), Object.assign(new Error("7 PERMISSION_DENIED"), { code: 7 })]) {
    const store = memoryWriter({ failCreate: writerFailure });
    const log = memoryLogger();
    let thrown: unknown;
    await crashRun(store.writer, log.logger).catch(error => { thrown = error; });
    assert.ok(thrown instanceof TypeError, "拋出的是清理的 TypeError，不是紀錄寫入錯誤");
    assert.notEqual(thrown, writerFailure);
    assert.equal(store.calls.filter(call => call.startsWith("create")).length, 1, "不重試寫入");
    assert.deepEqual(log.lines.filter(line => line.level === "error").map(line => line.label), ["retention-cleanup-run-crashed", "retention-cleanup-run-record-failed"]);
  }
});

test("G6A-3 日誌與時鐘本身也故障：仍拋出原始例外，且仍嘗試寫入紀錄", async () => {
  const store = memoryWriter();
  const brokenLogger = { log: () => { throw new Error("logger down"); }, error: () => { throw new Error("logger down"); } };
  let thrown: unknown;
  await runScheduledRetentionCleanup({ reader: crashingReader(), now: NOW, deleter: deleter(id => ({ id, outcome: "deleted", finalCleanupDate: null })).deleter, writer: store.writer, logger: brokenLogger, clock: () => { throw new Error("clock down"); } }).catch(error => { thrown = error; });
  assert.ok(thrown instanceof TypeError);
  const saved = onlyRecord(store.docs) as unknown as Record<string, unknown>;
  assert.equal(saved.result, "failed");
  assert.equal(saved.finishedAtUtc, "2027-01-19T19:00:05.123Z", "時鐘故障時以開始時間代替");
});

test("G6A-4 錯誤摘要：只保留類型與第一行，遮蔽金鑰／私鑰／token，保留公告 ID 路徑", () => {
  const multi = new Error("first line announcements/abc123/followUps/f1\n    at secret stack frame\n公告內文第二行");
  assert.equal(summarizeRetentionCleanupError(multi), "Error: first line announcements/abc123/followUps/f1");
  const leaked = new TypeError("key AIzaSyD-1234567890abcdefghijklmnop and Bearer ya29.a0AfH6SMBxyz and -----BEGIN PRIVATE KEY----- MIIEv");
  const summary = summarizeRetentionCleanupError(leaked);
  assert.doesNotMatch(summary, /AIza|ya29|MIIEv|PRIVATE KEY/);
  assert.match(summary, /^TypeError: key \[redacted\] and \[redacted\] and \[redacted\]$/);
  assert.match(summarizeRetentionCleanupError("x".repeat(500)), /^string: \[redacted\]$/, "超長編碼字串遮蔽");
  assert.ok(summarizeRetentionCleanupError(new Error("a ".repeat(300))).length <= 200);
  assert.equal(summarizeRetentionCleanupError(undefined), "undefined: undefined");
});

test("G6A-5 例外紀錄可重複辨識：同一次例外重複寫入為 duplicate，不覆蓋既有紀錄", async () => {
  const store = memoryWriter();
  const record = buildRetentionCleanupCrashRecord("2027-01-19T19:00:05.123Z", FINISHED, new TypeError("boom"));
  await store.writer.create(record.runId, record);
  const log = memoryLogger();
  await crashRun(store.writer, log.logger).catch(() => undefined);
  // 同一個 runId 已有不同內容（不同錯誤訊息）→ 改用 -2，原紀錄不變
  assert.equal(store.docs.size, 2);
  assert.equal((store.docs.get("2027-01-19T19-00-05.123Z") as Record<string, unknown[]>).errors[0], "TypeError: boom");
});

test("G6A-6 原始碼：例外處理只記錄並重新拋出，不重試清理；清理呼叫維持原樣", () => {
  const schedule = source("retentionCleanupSchedule.ts");
  const body = schedule.slice(schedule.indexOf("export async function runScheduledRetentionCleanup"), schedule.indexOf("export const retentionCleanupDaily"));
  assert.equal(body.match(/runRetentionCleanup\(/g)?.length, 1, "清理只呼叫一次");
  assert.match(body, /\} catch \(error\) \{\n[^\n]*\n\s*await recordRetentionCleanupCrash\(writer, now, clock, error, logger\);\n\s*throw error;\n\s*\}/);
  assert.match(schedule, /retryCount: 0/);
  assert.doesNotMatch(schedule, /timeoutSeconds/, "不調整 timeoutSeconds");
});
