import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  MEMORY_CAPTURE_SKILL_KEY,
  PLUGIN_ID,
  PLUGIN_VERSION,
} from "./constants.js";
import { MEMORY_CAPTURE_SKILL_MARKDOWN } from "./skills.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Done Memory Gate",
  description:
    "Requires agents to capture task lessons and key decisions in the memory knowledge graph before an issue can stay done.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "issues.read",
    "issues.update",
    "issues.wakeup",
    "issue.comments.read",
    "issue.comments.create",
    "issue.documents.read",
    "issue.relations.read",
    "skills.managed",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      allowIssueDocumentFallback: {
        type: "boolean",
        title: "Allow issue document fallback",
        description:
          "When true, a `memory` issue document with 200+ characters also satisfies the gate. Defaults to false: the gate requires an ARGO/ArchGraph element reference.",
        default: false,
      },
    },
  },
  skills: [
    {
      skillKey: MEMORY_CAPTURE_SKILL_KEY,
      displayName: "Task Memory Capture",
      slug: "task-memory-capture",
      description:
        "Before marking an agent task done, capture lessons, key decisions, and pitfalls in the project's memory knowledge graph.",
      markdown: MEMORY_CAPTURE_SKILL_MARKDOWN,
    },
  ],
};

export default manifest;
