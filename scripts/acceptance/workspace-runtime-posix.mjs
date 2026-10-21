import { spawnSync } from "node:child_process";

const target = "server/src/__tests__/workspace-runtime.test.ts";
const result = spawnSync(process.execPath, ["scripts/run-posix-suite.mjs", target], { stdio: "inherit" });
process.exit(result.status ?? 1);
