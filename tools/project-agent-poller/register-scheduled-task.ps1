# Registers a Windows Scheduled Task that runs the project agent poller
# every N minutes.
#
# Usage (run from an elevated-free PowerShell, in this folder):
#   .\register-scheduled-task.ps1 -BoardToken <paperclip-board-token>
#
# The board token and the GitHub token must be visible to the task. This script
# persists PAPERCLIP_BOARD_TOKEN to the current user's environment so the task
# (running as this user) inherits it. GH_TOKEN / GITHUB_TOKEN must already be
# set in the user environment (the poller uses the `gh` CLI).
#
# To remove:  Unregister-ScheduledTask -TaskName PaperclipProjectAgentPoller -Confirm:$false

[CmdletBinding()]
param(
  [string]$Config,
  [string]$TaskName = "PaperclipProjectAgentPoller",
  [int]$IntervalMinutes = 5,
  [string]$BoardToken = $env:PAPERCLIP_BOARD_TOKEN,
  [string]$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
)

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Config) { $Config = Join-Path $ScriptDir "projects.json" }

$poller = Join-Path $ScriptDir "poller.mjs"
if (-not (Test-Path $poller)) { throw "poller.mjs not found next to this script." }
if (-not (Test-Path $Config)) { throw "Config not found: $Config (copy projects.example.json to projects.json)." }
if (-not $Node) { throw "node not found on PATH." }

if ($BoardToken) {
  [Environment]::SetEnvironmentVariable("PAPERCLIP_BOARD_TOKEN", $BoardToken, "User")
  Write-Host "Set PAPERCLIP_BOARD_TOKEN (User scope)."
} elseif (-not [Environment]::GetEnvironmentVariable("PAPERCLIP_BOARD_TOKEN", "User")) {
  throw "Provide -BoardToken (or set PAPERCLIP_BOARD_TOKEN in the user environment)."
}

foreach ($ghVar in @("GH_TOKEN", "GITHUB_TOKEN")) {
  if (-not [Environment]::GetEnvironmentVariable($ghVar, "User") -and -not [Environment]::GetEnvironmentVariable($ghVar, "Machine")) {
    Write-Warning "$ghVar is not set in the user/machine environment; the poller's 'gh' calls may fail."
  }
}

# A console app started directly by Task Scheduler flashes a window on every
# run. Launch node through a VBScript that opens it with a hidden window (style
# 0) so the poller runs silently in the background.
$vbs = Join-Path $ScriptDir "run-poller.vbs"
$vbsContent = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$ScriptDir"
sh.Run """$Node"" ""$poller"" --config ""$Config""", 0, False
"@
Set-Content -Path $vbs -Value $vbsContent -Encoding ASCII

$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$action = New-ScheduledTaskAction `
  -Execute $wscript `
  -Argument "//Nologo //B `"$vbs`"" `
  -WorkingDirectory $ScriptDir

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Paperclip project agent poller: wakes a project's agent when new GitHub issues exist and no session is running." `
  -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' (every $IntervalMinutes min)."
Write-Host "Run now to test:  Start-ScheduledTask -TaskName $TaskName"
