param(
  [string]$ExePath = "",
  [int]$WaitSeconds = 20
)

$ErrorActionPreference = "Stop"

function Find-ZCodeExe {
  param([string]$ExplicitPath)

  $candidates = @()
  if ($ExplicitPath) { $candidates += $ExplicitPath }
  if ($env:ZCODE_EXE) { $candidates += $env:ZCODE_EXE }
  $candidates += "C:\Program Files\ZCode\ZCode.exe"
  $candidates += Join-Path $env:LOCALAPPDATA "Programs\ZCode\ZCode.exe"

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\ZCode.lnk"
  if (Test-Path -LiteralPath $shortcutPath) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -and (Test-Path -LiteralPath $shortcut.TargetPath)) {
      return (Resolve-Path -LiteralPath $shortcut.TargetPath).Path
    }
  }

  throw "ZCode.exe not found. Set ZCODE_EXE or reinstall ZCode."
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ZCodeWindowApi {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@ -ErrorAction SilentlyContinue

$exe = Find-ZCodeExe -ExplicitPath $ExePath
$launched = $false
$processes = @(Get-Process -Name "ZCode" -ErrorAction SilentlyContinue)
if ($processes.Count -eq 0) {
  Start-Process -FilePath $exe | Out-Null
  $launched = $true
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$mainProcess = $null
do {
  Start-Sleep -Milliseconds 500
  $processes = @(Get-Process -Name "ZCode" -ErrorAction SilentlyContinue)
  $mainProcess = $processes | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
} while (-not $mainProcess -and (Get-Date) -lt $deadline)

if (-not $mainProcess) {
  [pscustomobject]@{
    ok = $false
    launched = $launched
    exe = $exe
    processCount = $processes.Count
    actionRequired = "ZCode process started but no main window appeared."
  } | ConvertTo-Json -Depth 6
  exit 1
}

$handle = $mainProcess.MainWindowHandle
[void][ZCodeWindowApi]::ShowWindowAsync($handle, 9)
[void][ZCodeWindowApi]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 300

$rect = New-Object ZCodeWindowApi+RECT
[void][ZCodeWindowApi]::GetWindowRect($handle, [ref]$rect)

[pscustomobject]@{
  ok = $true
  launched = $launched
  exe = $exe
  processCount = $processes.Count
  mainWindow = @{
    processId = $mainProcess.Id
    title = $mainProcess.MainWindowTitle
    handle = [int64]$handle
    visible = [ZCodeWindowApi]::IsWindowVisible($handle)
    minimized = [ZCodeWindowApi]::IsIconic($handle)
    rect = @{
      left = $rect.Left
      top = $rect.Top
      right = $rect.Right
      bottom = $rect.Bottom
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
    }
  }
} | ConvertTo-Json -Depth 8

