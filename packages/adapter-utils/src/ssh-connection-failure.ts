/**
 * Classifies the SSH client's own connect diagnostics.
 *
 * Only the connect phase is eligible: Paperclip may retry it because the
 * remote command has not started, so a retry cannot duplicate work. A command
 * that fails after the connection is established (or is killed by the local
 * timeout) is deliberately not matched here.
 */
export const sshConnectionFailureReasons = [
  "connection_timeout",
  "connection_refused",
  "network_unreachable",
  "connection_reset",
  "dns_failure",
] as const;

export type SshConnectionFailureReason =
  (typeof sshConnectionFailureReasons)[number];

const connectReasonByDetail: ReadonlyArray<
  [RegExp, SshConnectionFailureReason]
> = [
  [/^connection timed out$/i, "connection_timeout"],
  [/^operation timed out$/i, "connection_timeout"],
  [/^connection refused$/i, "connection_refused"],
  [/^no route to host$/i, "network_unreachable"],
  [/^network is unreachable$/i, "network_unreachable"],
  [/^connection reset by peer$/i, "connection_reset"],
  [/^connection closed by remote host$/i, "connection_reset"],
];

// The ssh client emits `ssh: connect to host <host> port <port>: <detail>`.
// A wrapped caller (for example a lease-acquisition error) may prepend its own
// text on the same line, so match the diagnostic anywhere in the line rather
// than anchoring to the start of the string.
const connectDiagnostic =
  /ssh: connect to host \S+ port \d+: ([^\r\n]+)/i;
const hostnameDiagnostic =
  /ssh: could not resolve hostname \S+: ([^\r\n]+)/i;

function detailReason(detail: string): SshConnectionFailureReason | null {
  const normalized = detail.trim();
  for (const [pattern, reason] of connectReasonByDetail) {
    if (pattern.test(normalized)) return reason;
  }
  return null;
}

/** Classify one line or a whole multi-line diagnostic text. */
export function classifySshConnectionFailureText(
  text: string | null | undefined,
): SshConnectionFailureReason | null {
  if (typeof text !== "string" || text.length === 0) return null;
  for (const line of text.split(/\r?\n/)) {
    const connect = connectDiagnostic.exec(line);
    if (connect) {
      const reason = detailReason(connect[1]);
      if (reason) return reason;
    }
    const hostname = hostnameDiagnostic.exec(line);
    if (hostname && /name or service not known|nodename nor servname|temporary failure in name resolution|no such host/i.test(hostname[1])) {
      return "dns_failure";
    }
  }
  return null;
}

type ErrorWithStreams = {
  message?: unknown;
  stderr?: unknown;
};

/**
 * Prefer the transport's stderr (a subprocess's own diagnostic) and fall back
 * to the wrapped error message. Unknown values return null.
 */
export function readSshConnectionFailure(
  error: unknown,
): SshConnectionFailureReason | null {
  if (typeof error === "string") return classifySshConnectionFailureText(error);
  if (!error || typeof error !== "object") return null;
  const record = error as ErrorWithStreams;
  const stderr =
    typeof record.stderr === "string" ? record.stderr : null;
  const fromStderr = classifySshConnectionFailureText(stderr);
  if (fromStderr) return fromStderr;
  return typeof record.message === "string"
    ? classifySshConnectionFailureText(record.message)
    : null;
}

export function isSshConnectionFailure(error: unknown): boolean {
  return readSshConnectionFailure(error) !== null;
}
