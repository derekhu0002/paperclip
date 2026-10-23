import { describe, expect, it } from "vitest";
import {
  classifySshConnectionFailureText,
  readSshConnectionFailure,
} from "./ssh-connection-failure.js";

describe("ssh connection failure classification", () => {
  it.each([
    ["ssh: connect to host 100.87.205.43 port 2222: Connection timed out", "connection_timeout"],
    ["ssh: connect to host 100.87.205.43 port 2222: Operation timed out", "connection_timeout"],
    ["ssh: connect to host example.test port 22: Connection refused", "connection_refused"],
    ["ssh: connect to host example.test port 22: No route to host", "network_unreachable"],
    ["ssh: connect to host example.test port 22: Network is unreachable", "network_unreachable"],
    ["ssh: connect to host example.test port 22: Connection reset by peer", "connection_reset"],
  ] as const)("classifies the ssh client's connect diagnostic: %s", (text, reason) => {
    expect(classifySshConnectionFailureText(text)).toBe(reason);
  });

  it("classifies the diagnostic on a wrapped lease-acquisition message", () => {
    const message =
      'Failed to acquire lease for environment "WSL2 · aic-command" (ssh): ' +
      "ssh: connect to host 100.87.205.43 port 2222: Connection timed out";
    expect(classifySshConnectionFailureText(message)).toBe("connection_timeout");
  });

  it("classifies a hostname resolution failure", () => {
    expect(
      classifySshConnectionFailureText(
        "ssh: Could not resolve hostname build-host: Name or service not known",
      ),
    ).toBe("dns_failure");
  });

  it("prefers the transport stderr over a generic wrapper message", () => {
    expect(
      readSshConnectionFailure({
        message: "Command failed: ssh ...",
        stderr: "ssh: connect to host example.test port 22: Connection refused\n",
      }),
    ).toBe("connection_refused");
  });

  it("does not classify a command timeout after the connection was established", () => {
    expect(
      classifySshConnectionFailureText(
        "Command failed: ssh build-host 'sh -c ...'\n",
      ),
    ).toBeNull();
    expect(classifySshConnectionFailureText("ETIMEDOUT")).toBeNull();
  });

  it("does not classify unrelated output that merely mentions a host", () => {
    expect(
      classifySshConnectionFailureText(
        "remote log: connect to host example.test port 22 failed for the user",
      ),
    ).toBeNull();
  });

  it("returns null for unknown values", () => {
    expect(readSshConnectionFailure(null)).toBeNull();
    expect(readSshConnectionFailure(undefined)).toBeNull();
    expect(readSshConnectionFailure(42)).toBeNull();
    expect(readSshConnectionFailure({})).toBeNull();
  });
});
