/**
 * Fork-only Windows support for SSH execution targets.
 *
 * The upstream SSH runner builds POSIX shell commands (`cd ... && exec ...`).
 * Windows OpenSSH cannot run them, so the environment can opt into
 * `remoteOs: "windows"` and this module builds an equivalent PowerShell
 * command. Kept outside the upstream files so merges do not conflict.
 */

export type RemoteOs = "posix" | "windows";

/** Accept POSIX absolute paths, Windows drive paths and UNC paths. */
export function isAbsoluteRemoteWorkspacePath(value: string): boolean {
  return value.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

/** Quote a value for a PowerShell single-quoted string literal. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function windowsPowerShell(script: string): string {
  // EncodedCommand is UTF-16LE base64: it survives cmd, bash and PowerShell
  // shells without any nested quoting, and works whether OpenSSH lands in
  // Windows PowerShell, cmd, or a WSL shell with Windows interop.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

/**
 * Build a Windows remote command that runs in `cwd` with `env`.
 * The command and its args are invoked by name/path through the PowerShell
 * call operator, so both executables and `.ps1`/`.cmd` shims resolve from PATH.
 */
export function buildWindowsRemoteCommand(input: {
  cwd: string;
  command: string;
  args: readonly string[];
  env: Record<string, string>;
}): string {
  const statements: string[] = [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath ${psQuote(input.cwd)}`,
  ];

  for (const [key, value] of Object.entries(input.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (key.toUpperCase() === "PATH") {
      // Prepend instead of replacing, so the Windows OpenSSH PATH survives.
      statements.push(`$env:PATH = ${psQuote(value)} + ';' + $env:PATH`);
    } else {
      statements.push(`$env:${key} = ${psQuote(value)}`);
    }
  }

  const invocation = `& ${psQuote(input.command)}${input.args.map((arg) => ` ${psQuote(arg)}`).join("")}`;
  statements.push(invocation);
  // A PowerShell function/shim may leave $LASTEXITCODE unset.
  statements.push("if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }");

  return windowsPowerShell(statements.join("; "));
}

/** Windows equivalent of `mkdir -p <path> && cd <path> && pwd`. */
export function buildWindowsWorkspaceProbeCommand(remotePath: string): string {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `if (-not (Test-Path -LiteralPath ${psQuote(remotePath)})) { New-Item -ItemType Directory -Path ${psQuote(remotePath)} -Force | Out-Null }`,
    `Set-Location -LiteralPath ${psQuote(remotePath)}`,
    "(Get-Location).Path",
  ].join("; ");
  return windowsPowerShell(script);
}
