export const PLUGIN_ID = "paperclip.done-memory-gate";
export const PLUGIN_VERSION = "0.1.0";

export const MEMORY_DOCUMENT_KEY = "memory";
export const MEMORY_DOCUMENT_MIN_CHARS = 200;

/** Machine-readable marker an agent leaves on its own comment line: `memory-capture: <ref>`. */
export const MEMORY_MARKER_PATTERN = /(?:^|\n)[ \t]*(?:[-*][ \t]+)?memory-capture[ \t]*:[ \t]*(\S[^\n]*)/i;

/**
 * A memory reference must point at a real graph element:
 * `argo:<graphKey>#<elementId>`.
 */
export const GRAPH_MEMORY_REFERENCE_PATTERN = /^argo:\S+#\S+$/;

export const STATE_NAMESPACE = "done-memory-gate";
/** Set once a reminder follow-up issue was created for a finished conversation. */
export const STATE_KEY_REMINDED = "reminded";

export const CONTRACT_COMMENT_PREFIX = "[done-memory-gate]";
