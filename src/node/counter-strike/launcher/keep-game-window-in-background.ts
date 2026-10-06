import { spawn, type ChildProcess } from 'node:child_process';
import { Game } from 'csdm/common/types/counter-strike';
import { RecordingWindowMode } from 'csdm/common/types/recording-window-mode';
import { isWindows } from 'csdm/node/os/is-windows';

// How long the script gives the focus back to the previous window when the game steals it.
// The game takes the focus when it starts and when the demo is loaded, after that delay users can focus the game window
// if they want to look at it.
const FOCUS_GUARD_SECONDS = 90;
// How long the script waits for the game window to appear before giving up.
const GAME_START_TIMEOUT_SECONDS = 300;
// How long the script waits for the game to be restarted before exiting, the game may be restarted when the launcher
// kills a previous instance.
const GAME_EXIT_GRACE_SECONDS = 30;

function buildScript(processName: string, offScreen: boolean) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CsdmWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$processName = '${processName}'
$offScreen = $${offScreen ? 'true' : 'false'}
$HWND_BOTTOM = [IntPtr]1
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOACTIVATE = 0x0010
$SM_XVIRTUALSCREEN = 76
$previousWindow = [CsdmWindow]::GetForegroundWindow()
$startDeadline = (Get-Date).AddSeconds(${GAME_START_TIMEOUT_SECONDS})
$focusGuardDeadline = $null
$exitDeadline = $null

function Restore-PreviousWindowFocus($gameWindow) {
  if ($previousWindow -eq [IntPtr]::Zero -or -not [CsdmWindow]::IsWindow($previousWindow)) { return }
  $foregroundWindow = [CsdmWindow]::GetForegroundWindow()
  if ($foregroundWindow -ne $gameWindow) { return }
  # Windows prevents background processes from changing the foreground window, attaching our thread to the
  # foreground window thread lifts this restriction.
  $foregroundThreadId = [CsdmWindow]::GetWindowThreadProcessId($foregroundWindow, [IntPtr]::Zero)
  $currentThreadId = [CsdmWindow]::GetCurrentThreadId()
  [void][CsdmWindow]::AttachThreadInput($currentThreadId, $foregroundThreadId, $true)
  [void][CsdmWindow]::BringWindowToTop($previousWindow)
  [void][CsdmWindow]::SetForegroundWindow($previousWindow)
  [void][CsdmWindow]::AttachThreadInput($currentThreadId, $foregroundThreadId, $false)
}

while ($true) {
  $gameProcess = Get-Process -Name $processName | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if ($null -eq $gameProcess) {
    if ($null -ne $focusGuardDeadline) {
      # The game exited, wait a bit in case it's restarted and handle the new window.
      if ($null -eq $exitDeadline) { $exitDeadline = (Get-Date).AddSeconds(${GAME_EXIT_GRACE_SECONDS}) }
      if ((Get-Date) -gt $exitDeadline) { break }
      $focusGuardDeadline = (Get-Date).AddSeconds(${FOCUS_GUARD_SECONDS})
    } elseif ((Get-Date) -gt $startDeadline) {
      break
    }
    Start-Sleep -Milliseconds 250
    continue
  }
  $exitDeadline = $null

  if ($null -eq $focusGuardDeadline) {
    $focusGuardDeadline = (Get-Date).AddSeconds(${FOCUS_GUARD_SECONDS})
  }
  $isFocusGuardActive = (Get-Date) -lt $focusGuardDeadline
  $gameWindow = $gameProcess.MainWindowHandle

  if ($offScreen) {
    # Keep the window outside of the screens for the whole recording, the game may move it when it changes the
    # resolution.
    $rect = New-Object CsdmWindow+RECT
    [void][CsdmWindow]::GetWindowRect($gameWindow, [ref]$rect)
    $x = [CsdmWindow]::GetSystemMetrics($SM_XVIRTUALSCREEN) - ($rect.Right - $rect.Left) - 100
    if ($rect.Left -ne $x) {
      [void][CsdmWindow]::SetWindowPos($gameWindow, $HWND_BOTTOM, $x, 0, 0, 0, $SWP_NOSIZE -bor $SWP_NOACTIVATE)
    }
  } elseif ($isFocusGuardActive) {
    [void][CsdmWindow]::SetWindowPos($gameWindow, $HWND_BOTTOM, 0, 0, 0, 0, $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOACTIVATE)
  }

  if ($isFocusGuardActive) {
    Restore-PreviousWindowFocus $gameWindow
    Start-Sleep -Milliseconds 250
  } else {
    Start-Sleep -Milliseconds 1000
  }
}
`;
}

export type GameWindowKeeper = {
  stop: () => void;
};

/**
 * Starts a background PowerShell script that keeps the game window behind the other windows (and optionally outside of
 * the screens) while recording, so users can keep using their computer.
 * The game keeps rendering frames because the window is never minimized.
 * It does nothing on other platforms than Windows.
 */
export function keepGameWindowInBackground(game: Game, mode: RecordingWindowMode): GameWindowKeeper {
  const noop = { stop: () => {} };
  if (!isWindows || mode === RecordingWindowMode.Normal) {
    return noop;
  }

  const processName = game === Game.CSGO ? 'csgo' : 'cs2';
  const script = buildScript(processName, mode === RecordingWindowMode.OffScreen);
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');

  let child: ChildProcess | undefined;
  try {
    child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        encodedScript,
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    child.on('error', (error) => {
      logger.warn('Failed to start the game window background script');
      logger.warn(error);
    });
    logger.debug(`Game window background script started in ${mode} mode`);
  } catch (error) {
    logger.warn('Failed to start the game window background script');
    logger.warn(error);
    return noop;
  }

  return {
    stop: () => {
      if (child && child.exitCode === null) {
        child.kill();
      }
    },
  };
}
