import { describe, expect, it, vi } from "vitest";
import {
  createSocketDisconnectGuard,
  installSocketDisconnectGuard,
  isRecoverableSocketDisconnect,
} from "../services/socket-disconnect-guard.js";

function socketError(code: string, syscall?: string) {
  return Object.assign(new Error(`write ${code}`), syscall === undefined ? { code } : { code, syscall });
}

describe("socket disconnect guard", () => {
  it("treats a broken pipe on a write as a dropped connection", () => {
    expect(isRecoverableSocketDisconnect(socketError("EPIPE", "write"))).toBe(true);
    expect(isRecoverableSocketDisconnect(socketError("EPIPE"))).toBe(true);
  });

  it("keeps every other uncaught exception fatal", () => {
    expect(isRecoverableSocketDisconnect(socketError("EPIPE", "read"))).toBe(false);
    expect(isRecoverableSocketDisconnect(socketError("ECONNRESET", "write"))).toBe(false);
    expect(isRecoverableSocketDisconnect(new TypeError("boom"))).toBe(false);
    expect(isRecoverableSocketDisconnect("write EPIPE")).toBe(false);
    expect(isRecoverableSocketDisconnect(null)).toBe(false);
  });

  it("logs a dropped connection instead of throwing it", () => {
    const warn = vi.fn();
    const guard = createSocketDisconnectGuard(warn);
    const error = socketError("EPIPE", "write");
    expect(() => guard(error)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(error);
  });

  it("rethrows an uncaught exception that is not a dropped connection", () => {
    const warn = vi.fn();
    const guard = createSocketDisconnectGuard(warn);
    const error = new TypeError("boom");
    expect(() => guard(error)).toThrow(error);
    expect(warn).not.toHaveBeenCalled();
  });

  it("installs one process listener and removes it again", () => {
    const before = process.listenerCount("uncaughtException");
    const dispose = installSocketDisconnectGuard(vi.fn());
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    dispose();
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
