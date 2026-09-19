import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const firebaseExecutable = resolve(
  "node_modules",
  "firebase-tools",
  "lib",
  "bin",
  "firebase.js",
);

const cliConfigRoot = mkdtempSync(join(tmpdir(), "ysjh-firebase-cli-"));
let result;

try {
  result = spawnSync(
    process.execPath,
    [
      firebaseExecutable,
      "emulators:exec",
      "--only",
      "firestore",
      "--project",
      "demo-ysjh-info-rules-test",
      "node --test tests/firestoreRules.emulator.mjs",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CI: "true",
        FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
        XDG_CONFIG_HOME: cliConfigRoot,
      },
    },
  );
} finally {
  for (const logFile of ["firestore-debug.log", "firebase-debug.log"]) {
    rmSync(resolve(logFile), { force: true });
  }
  rmSync(cliConfigRoot, { recursive: true, force: true });
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
