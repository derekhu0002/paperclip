export const PLUGIN_ID = "paperclip-project-tree";
export const PLUGIN_VERSION = "0.1.0";
export const PAGE_ROUTE = "organization";
export const DATA_KEYS = {
  tree: "project-tree",
} as const;

export const SLOT_IDS = {
  page: "project-tree-page",
  sidebar: "project-tree-sidebar-link",
} as const;

export const EXPORT_NAMES = {
  page: "ProjectTreePage",
  sidebar: "ProjectTreeSidebarLink",
} as const;
