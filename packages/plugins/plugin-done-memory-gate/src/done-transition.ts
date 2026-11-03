function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * True only when an `issue.updated` payload describes a real transition into
 * `done`. Editing an issue that was already done must not re-trigger the gate.
 */
export function isDoneTransition(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  const changes = readRecord(payload.changes);
  const statusChange = readRecord(changes.status);
  if (statusChange.to === "done") return true;

  const previous = readRecord(payload._previous);
  if (payload.status === "done") return previous.status !== "done";
  return false;
}

export function isPluginOperationIssue(originKind: string | null | undefined): boolean {
  return typeof originKind === "string" && originKind.startsWith("plugin:");
}
