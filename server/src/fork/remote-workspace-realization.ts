import { asString, parseObject } from "../adapters/utils.js";

/**
 * Fork helper: read the remote workspace identity recorded on a persisted
 * execution workspace. Kept outside the upstream workspace-runtime module so
 * upstream merges do not conflict with the direct-remote-workspace feature.
 */
export function readRemoteWorkspaceRealization(
  metadata: Record<string, unknown> | null | undefined,
): { host: string; path: string } | null {
  const realization = parseObject(parseObject(metadata).workspaceRealization);
  const remote = parseObject(realization.remote);
  const host = asString(remote.host, "").trim();
  const remotePath = asString(remote.path, "").trim();
  return host && remotePath ? { host, path: remotePath } : null;
}
