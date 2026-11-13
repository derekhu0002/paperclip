import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, PLUGIN_VERSION, STATUS_ROUTE_PATH } from "./shared.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Business Cockpit",
  description:
    "A company-scoped business operating cockpit. Key results on top, the process drivers that move them below, and a per-company editable profile that defines results, drivers, causal weights, targets and metric sources.",
  author: "paperclip",
  categories: ["ui"],
  capabilities: [
    "activity.log.write",
    "agents.read",
    "api.routes.register",
    "goals.read",
    "issues.read",
    "plugin.state.read",
    "plugin.state.write",
    "ui.dashboardWidget.register",
    "ui.page.register",
    "ui.sidebar.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  apiRoutes: [
    {
      routeKey: "overview",
      method: "GET",
      path: "/overview",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "ingest-metrics",
      method: "POST",
      path: "/metrics",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" },
    },
    {
      routeKey: "save-profile",
      method: "POST",
      path: "/profile",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" },
    },
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "business-status-sidebar",
        displayName: "Business Cockpit",
        exportName: "BusinessStatusSidebarLink",
        order: 30,
      },
      {
        type: "page",
        id: "business-status-page",
        displayName: "Business Cockpit",
        exportName: "BusinessStatusPage",
        routePath: STATUS_ROUTE_PATH,
      },
      {
        type: "dashboardWidget",
        id: "business-status-widget",
        displayName: "Business Cockpit",
        exportName: "BusinessStatusWidget",
      },
    ],
  },
};

export default manifest;
