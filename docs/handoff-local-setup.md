# Handoff: install and verify the automation update locally

This document is written for an AI agent (e.g. Claude Code) running on the user's Windows PC. It explains what changed
on the `main` branch of this fork, how to install it and how to verify it before switching the existing
automation to it. Decide each step based on what is already installed on the machine.

The changes have only been validated with unit tests, linting and type checking (Linux sandbox without Counter-Strike
or GPU). Nothing has been tested in-game yet, follow the verification steps below before relying on it.

## What's new

| Area           | Change                                                                                                                                                                                                              | Where                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Encoding       | FFmpeg presets: AV1 10-bit (NVENC/AMF/QSV/SVT-AV1), HEVC/H.264 NVENC, x264 HQ, ProRes. `--preset auto` test-encodes and picks the fastest working AV1 encoder.                                                      | `src/node/video/ffmpeg/ffmpeg-presets.ts`, `detect-ffmpeg-presets.ts` |
| Encoding fixes | 10-bit pixel formats are no longer overridden by a forced `yuv420p`, HLAE now uses the FFmpeg executable of the video job, the custom FFmpeg toggle is respected.                                                   | `create-cs2-video-json-file.ts`, `generate-video.ts`                  |
| Seeking        | CS2 sequences are chained without restarting the demo at tick 0 (short gaps are played, long gaps use a forward seek). `--no-fast-seek` restores the old behavior.                                                  | `create-cs2-video-json-file.ts`                                       |
| Game window    | `--window-mode background` (default): game behind other windows, focus given back. `off-screen`: outside the monitors. `hidden` (experimental): window hidden. `normal`: old behavior.                              | `keep-game-window-in-background.ts`                                   |
| Recording      | Full speed and audio kept when the game is unfocused, a running game is closed before recording (it used to make the job fail), the sequence being recorded is reported.                                            | `generate-video.ts`, `watch-recording-progress.ts`                    |
| CLI            | `--json` events, `doctor`, `matches`, `highlights`, `video --mode highlights --top N`, multiple demos per `video` call, `--merge-output`, `--resolution 4k`, `--hide-player-names`, auto analysis of missing demos. | `src/cli/`                                                            |
| Downloads      | `dl-valve --history` downloads every match since the last run with the Steam match history API (share codes), all `dl-*` commands print `Demo downloaded at <path>`.                                                | `download-valve-command.ts`, `src/node/valve-match/`                  |
| Fixes          | Relative paths sent to the daemon, FFmpeg concat list escaping, HLAE take folder selection.                                                                                                                         | various                                                               |
| Settings       | Schema v15 adds `video.fastSeek` and `video.windowMode` (migrated automatically), optional `playback.linuxLaunchCommandPrefix`.                                                                                     | `src/node/settings/`                                                  |

The complete CLI reference, including the JSON event format, is in [automation.md](automation.md).

## 1. Get the code

```powershell
git checkout main
git pull origin main
```

## 2. Build

Requirements: Node.js 24 (see `devEngines` in `package.json`), Vite+ (`npm i -g vite-plus`), Git. Then:

```powershell
vp install
vp run build          # bundles out/main.js, out/server.js, out/cli.js...
```

Two ways to use it:

- Without installing: run the CLI with the Electron runtime of the checkout from the repository root,
  `scripts\cli.bat <command>` (same commands as `csdm`). The desktop app can be started with `vp run electron`.
- Installed: `vp run package` creates the installer in `dist/`. Installing it replaces the current CS Demo Manager
  installation and its `csdm` command (settings and database are kept).

If an older CS Demo Manager is running, close it first: the CLI and the app share a background daemon and an outdated
daemon is not replaced while clients are connected.

## 3. Verify (in this order)

1. `scripts\cli.bat doctor` (or `csdm doctor`): database OK, Steam running, CS2 found, HLAE and FFmpeg installed (the
   `video` command installs missing ones). The preset list shows which AV1 encoders work on this GPU.
2. `scripts\cli.bat highlights "<demo.dem>" --steamids <steamId> --min-kills-in-round 3`: highlights are listed (the
   demo is analyzed first if needed).
3. Short recording test with 2-3 highlights:
   `scripts\cli.bat video "<demo.dem>" --mode highlights --steamids <steamId> --top 3 --resolution 4k --framerate 120 --preset auto --output "<existing folder>" --json`
   - Every sequence must be in the output folder (`done` event lists the files). If one is missing, retry with
     `--no-fast-seek` and report it.
   - The game window must stay in the background. If it doesn't, or if the recording stalls, retry with
     `--window-mode off-screen`, then `--window-mode normal`.
   - Check the resolution of the output with `ffprobe`. A 4K game window larger than the monitor may be limited to the
     desktop size, enable NVIDIA DSR / AMD VSR in that case.
4. `--window-mode hidden` is experimental, try it only after the default mode works.

Logs: `%USERPROFILE%\.csdm\logs\csdm.log` (daemon, `.csdm-dev` for dev builds) and `csdm.log` next to `cs2.exe` (game plugin, it contains the
executed commands and the `CSDM_SEQUENCE_START <n>` markers).

## 4. Integrate with the existing automation

- Replace manual tick ranges by `video <demo...> --mode highlights --steamids <id> --top <n>` or, for full control,
  `highlights --json` -> pick highlights -> write a `--config-file` JSON with the chosen `sequences`.
- Parse stdout line by line when using `--json`, wait for `done`/`error` events and check the exit code.
- Downloads:
  - `dl-valve --history --steamid <id>` after a first run with `--auth-code` and `--known-code` (the Steam API key comes
    from the app settings or `--steam-api-key`). Share codes obtained elsewhere (e.g. an existing Python script using
    the Steam or Leetify APIs) can be downloaded with `dl-valve <shareCode1> <shareCode2>`.
  - Leetify is not integrated in the CLI: its API could not be verified from the sandbox. If the local script gets
    share codes or demo URLs from Leetify, pass the share codes to `dl-valve`, or download the demo files directly and
    give their paths to `analyze`/`video`.
- Keep API keys and authentication codes out of the repository: they belong to the app settings, environment
  variables or local files of the automation, the `share-code-history.json` file is stored in the app folder (`%USERPROFILE%\.csdm`).

## 5. Known limitations

- The CS2 server plugin binaries in `static/` were not modified (they can't be rebuilt from the sandbox). Everything
  new works through the existing plugin commands.
- The Steam match history API may return the latest match a few minutes after it ended.
- HLAE is Windows only, Linux recordings use the game `startmovie` command (TGA images, large disk usage).
