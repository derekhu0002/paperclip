#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/run-posix-suite.mjs <test-file>");
  process.exit(2);
}

if (process.platform === "win32") {
  console.log(`SKIP (win32): ${target} needs sh and symlinks; run it on Linux, WSL, or the deploy host.`);
  process.exit(0);
}

const result = spawnSync("pnpm", ["vitest", "run", target], { stdio: "inherit" });
process.exit(result.status ?? 1);
