import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The approval helper is the ArchGraph adapter inside the Paperclip repo. It
// reads design/KG by default and must also accept an external provider payload
// for any other graph framework.
const HELPER_PATH = fileURLToPath(new URL("../../../skills/paperclip/scripts/paperclip-approval-with-graph.mjs", import.meta.url));

const archgraphDocument = {
  elements: [
    { id: "a", name: "A", type: "Application Component" },
    { id: "b", name: "B", type: "Application Component" },
  ],
  relationships: [{ id: "r1", source_id: "a", target_id: "b", type: "Serving" }],
  views: [{ view_id: "v1", view_name: "Main", included_elements: ["a", "b"] }],
};

const providerPayload = {
  schemaVersion: 1,
  provider: { name: "test-graph", version: "9.9.9", fingerprint: "abc", profileVersion: "1.0.0" },
  snapshotHash: "hash-1",
  focusElementIds: ["a"],
  preview: {
    nodes: [
      { id: "a", name: "A", type: "Application Component" },
      { id: "b", name: "B", type: "Application Component" },
    ],
    edges: [{ sourceId: "a", targetId: "b", type: "Serving" }],
  },
  highlight: { added: [], removed: [], changed: [] },
  summary: "Graph evidence",
};

function runHelper(args: string[], env: Record<string, string> = {}, cwd?: string) {
  return execFileSync(process.execPath, [HELPER_PATH, ...args], {
    encoding: "utf8",
    cwd: cwd ?? os.tmpdir(),
    env: { ...process.env, PAPERCLIP_TASK_ID: "issue-1", ARGO_REPO_ROOT: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("paperclip approval with graph helper", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.();
  });

  function tempDir(prefix: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
  }
  function tempFile(name: string, content: string) {
    const dir = tempDir("graph-context-");
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  }

  it("reads design/KG/SystemArchitecture.json by default and adds the contract", () => {
    const cwd = tempDir("archgraph-repo-");
    fs.mkdirSync(path.join(cwd, "design", "KG"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "design", "KG", "SystemArchitecture.json"), JSON.stringify(archgraphDocument));
    const output = JSON.parse(runHelper(["--title", "Approve", "--dry-run", "true"], {}, cwd));
    const context = output.payload.graphContext;
    expect(context.schemaVersion).toBe(1);
    expect(context.provider.name).toBe("archgraph");
    expect(context.preview.nodes.map((node: { id: string }) => node.id)).toEqual(["a", "b"]);
    expect(context.preview.edges).toHaveLength(1);
    expect(typeof context.snapshotHash).toBe("string");
  });

  it("forwards an external provider payload unchanged", () => {
    const file = tempFile("context.json", JSON.stringify(providerPayload));
    const output = JSON.parse(runHelper(["--graph-context", file, "--title", "Approve", "--dry-run", "true"]));
    expect(output.type).toBe("request_board_approval");
    expect(output.payload.graphContext).toEqual(providerPayload);
  });

  it("runs a provider command for a non-ArchGraph framework", () => {
    const provider = tempFile("provider.mjs", `process.stdout.write(${JSON.stringify(JSON.stringify(providerPayload))});`);
    const output = JSON.parse(runHelper(
      ["--graph-context-cmd", `"${process.execPath}" "${provider}"`, "--title", "Approve", "--dry-run", "true"],
    ));
    expect(output.payload.graphContext.provider.name).toBe("test-graph");
  });

  it("fails loudly when neither a graph document nor a provider exists", () => {
    expect(() => runHelper(["--title", "Approve", "--dry-run", "true"])).toThrow();
  });

  it("rejects an external payload without a contract version", () => {
    const file = tempFile("context.json", JSON.stringify({ ...providerPayload, schemaVersion: undefined }));
    expect(() => runHelper(["--graph-context", file, "--title", "Approve", "--dry-run", "true"])).toThrow();
  });
});
