import { spawnSync } from "node:child_process";

const target = "packages/adapters/opencode-local/src/server/execute.remote.test.ts";
const result = spawnSync(process.execPath, ["scripts/run-posix-suite.mjs", target], { stdio: "inherit" });
process.exit(result.status ?? 1);
