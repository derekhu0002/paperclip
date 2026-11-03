export const PLUGIN_ID = "paperclip.done-memory-gate";
export const PLUGIN_VERSION = "0.1.0";

export const MEMORY_DOCUMENT_KEY = "memory";
export const MEMORY_DOCUMENT_MIN_CHARS = 200;

/** Machine-readable marker an agent leaves on its own comment line: `memory-capture: <id>`. */
export const MEMORY_MARKER_PATTERN = /(?:^|\n)[ \t]*(?:[-*][ \t]+)?memory-capture[ \t]*:[ \t]*(\S[^\n]*)/i;

export const MAX_GATE_ATTEMPTS = 3;
export const STATE_NAMESPACE = "done-memory-gate";
export const STATE_KEY_ATTEMPTS = "attempts";
export const STATE_KEY_EXHAUSTED_NOTIFIED = "exhausted-notified";

export const MEMORY_CAPTURE_SKILL_KEY = "task-memory-capture";
export const CONTRACT_COMMENT_PREFIX = "[done-memory-gate]";
