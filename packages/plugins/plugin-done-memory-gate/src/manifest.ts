import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  PLUGIN_ID,
  PLUGIN_VERSION,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Done Memory Gate",
  description:
    "Checks a finished agent conversation for a graph memory element and creates a follow-up task when it is missing.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "issues.read",
    "agents.invoke",
    "issue.comments.read",
    "issue.documents.read",
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
          "When true, a `memory` issue document with 200+ characters also satisfies the check. Defaults to false: the graph element reference is required.",
        default: false,
      },
    },
  },
};

export default manifest;
