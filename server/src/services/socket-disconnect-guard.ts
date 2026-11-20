/**
 * A peer that closes its connection while this process is still writing to it
 * surfaces as `EPIPE` on the socket. Node reports it as an uncaught exception
 * on the `Socket` instance, so without this guard one disconnected client
 * ends the whole server process. That happened twice on this instance
 * (2026-11-16 and 2026-11-19): every in-flight run lost its in-memory handle
 * and stayed `process_detached` until an operator stopped it by hand.
 *
 * The guard is deliberately narrow: only `EPIPE` from a write is treated as a
 * dropped connection. Every other uncaught exception stays fatal, so a real
 * defect still stops the process instead of leaving it in an unknown state.
 */

const RECOVERABLE_SOCKET_CODES = new Set(["EPIPE"]);

export function isRecoverableSocketDisconnect(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; syscall?: unknown };
  if (typeof candidate.code !== "string" || !RECOVERABLE_SOCKET_CODES.has(candidate.code)) {
    return false;
  }
  // `write` is the failure this guard exists for. An EPIPE that names no
  // syscall is treated the same way; an EPIPE on another syscall stays fatal.
  return candidate.syscall === undefined || candidate.syscall === "write";
}

export type SocketDisconnectWarn = (error: unknown) => void;

/** The handler an `uncaughtException` listener runs. Exported for tests. */
export function createSocketDisconnectGuard(warn: SocketDisconnectWarn) {
  return (error: unknown): void => {
    if (!isRecoverableSocketDisconnect(error)) throw error;
    warn(error);
  };
}

/** Installs the guard once. Returns a disposer for tests. */
export function installSocketDisconnectGuard(warn: SocketDisconnectWarn): () => void {
  const handler = createSocketDisconnectGuard(warn);
  process.on("uncaughtException", handler);
  return () => process.removeListener("uncaughtException", handler);
}
