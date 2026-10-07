# Automating CS Demo Manager (CLI guide for scripts and AI agents)

Installing this version from source and verifying it: [install-from-source.md](install-from-source.md).

This guide covers the part of a clip pipeline between "demos are on disk" and "video clips are exported":
analyze demos, find highlights, record them with the game and encode them (e.g. 4K 120 FPS AV1).

Every command below is available through the `csdm` CLI installed with the app (on Windows the installer adds it to the
`PATH`). From a source checkout, use `vp run dev:cli` once to build `out/cli.js` and run `node out/cli.js <command>`
(or `scripts/cli.bat` / `scripts/cli.sh` to run it with the Electron runtime).

The CLI talks to a background daemon (the same one used by the desktop app). The daemon starts the bundled PostgreSQL
database automatically (embedded mode, the default) or connects to the database configured in the app settings
(external mode). Commands that need the database start the daemon on demand, no manual setup is required.

## Machine readable output

Add `--json` to `analyze`, `video`, `highlights`, `matches`, `doctor` and `video presets|list|pause|resume`.

- stdout then contains only newline-delimited JSON objects, one per line, each with a `type` property.
- One-shot commands (`highlights`, `matches`, `doctor`, `video presets`, `video list`) print a single
  `{"type":"result","data":...}` line.
- Long-running commands (`analyze`, `video`) stream events and end with `done` (success) or `error` events.
- The exit code is `0` on success and `1` on failure, always check it.

## Typical pipeline

```sh
# 0. Once: check the environment and which encoding presets work on this computer (GPU encoders are test-encoded).
csdm doctor --json

# 1. Download the latest matches (each downloaded demo path is printed as "Demo downloaded at <path>").
csdm dl-valve
#    Or every match played since the last run with the Steam match history API (see "Valve demos" below).
csdm dl-valve --history --steamid 76561198000000000

# 2. Analyze them (optional, video/highlights analyze missing demos automatically).
csdm analyze "C:\Users\me\Videos\demos" --json

# 3. Pick matches and preview highlights.
csdm matches --steamid 76561198000000000 --limit 5 --json
csdm highlights "C:\demos\match.dem" --steamids 76561198000000000 --min-kills-in-round 3 --json

# 4. Record the best highlights of several demos in 4K 120 FPS AV1 and merge everything into one file.
#    The --output folder must exist.
csdm video "C:\demos\match1.dem" "C:\demos\match2.dem" --mode highlights --steamids 76561198000000000 --top 10 --resolution 4k --framerate 120 --preset auto --window-mode background --output "D:\clips" --merge-output "D:\clips\all.mp4" --json
```

## Commands

### `dl-valve`

Without arguments, downloads the demos of the recent games list returned by the game coordinator (the last matches
only, it sometimes misses the most recent one). Steam must be running and logged in.

`--history` uses the official Steam match history API instead: every match played after the last downloaded one is
downloaded. The first run needs the game authentication code and the share code of one of your matches, both available
on the [Steam help page](https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128):

```sh
csdm dl-valve --history --steamid 76561198000000000 --auth-code XXXX-XXXXX-XXXX --known-code CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
```

They are saved in `share-code-history.json` in the app folder, the next runs only need `--history --steamid <id>`.
A Steam API key is required (app settings or `--steam-api-key`). The API can take a few minutes to return a match that
just ended, re-run the command later if the latest match is missing. The download itself still goes through the Steam
client (it must be running), demos older than ~30 days are not available anymore on Valve servers.

### `doctor`

Checks the settings file, database, Steam, CS2, HLAE (Windows) and FFmpeg, then encodes 5 frames with every encoding
preset to report the ones usable on this computer. `--skip-encoders` skips the encode tests. Exit code is `1` only
when the database is not reachable.

### `matches`

Lists the latest analyzed matches (most recent first). Options: `--limit <n>` (default 10), `--steamid <id>` (only
matches of this player, includes the player's stats: K/D/A, ADR, KAST, HLTV 2.0 rating, 2k/3k/4k/5k rounds),
`--map <name>`.

### `highlights <demo>`

Returns one highlight per player and round with the kills (tick, victim, weapon, headshot, wallbang, no-scope, through
smoke, airborne, blinded), the clutch information, a score (higher is better) and suggested `startTick`/`endTick`.
The demo is analyzed first when it's not in the database (`--no-analyze` to fail instead).

Options: `--steamids <id1,id2>` (required), `--min-kills-in-round <n>` (won clutches are always kept), `--top <n>`
(best scores, result stays sorted by round), `--rounds <1,2>`, `--weapons <ak47,awp,deagle>` (weapon ids or names,
case-insensitive), `--headshots-only`.

### `video`

Generation modes:

- `csdm video <demo> <startTick> <endTick>`: one sequence, `--focus-player <steamId>` to follow a player.
- `csdm video <demo...> --mode highlights --steamids <ids>`: one sequence per highlight (same filters as the
  `highlights` command plus `--top`), `--start-seconds-before` (default 3) / `--end-seconds-after` (default 2).
- `csdm video <demo...> --mode player --steamids <ids> --event kills|deaths|rounds`: sequences built from player
  events, `--perspective player|enemy`, `--rounds`, and for kills `--weapons` / `--headshots-only`.
- `csdm video --config-file <file.json>`: full control over sequences, see `VideoCommandConfig` in
  `src/cli/commands/video-command.ts` (`ffmpegPreset`, `fastSeek` and `windowMode` keys are supported too).

With several demos, one video is generated per demo (demos without matching events are skipped) and
`--merge-output <file>` merges all of them into a single file (same container as the videos).

Quality and encoding:

- `--resolution 720p|1080p|1440p|4k|<width>x<height>`, `--framerate <fps>`.
- `--preset <id>|auto`: FFmpeg encoding preset, list them with `csdm video presets`. `auto` picks the fastest working
  AV1 encoder (NVENC > AMF > Quick Sync > SVT-AV1). Explicit `--ffmpeg-*` options override the preset.
- `--recording-system HLAE|CS` (HLAE is Windows only and encodes on the fly through FFmpeg, it's the recommended
  system for high resolutions/framerates because no image is written to the disk).

| Preset       | Codec        | Container | Notes                                  |
| ------------ | ------------ | --------- | -------------------------------------- |
| `av1-nvenc`  | `av1_nvenc`  | mp4       | 10-bit, NVIDIA RTX 40 series or newer  |
| `av1-amf`    | `av1_amf`    | mp4       | 10-bit, AMD RX 7000 series or newer    |
| `av1-qsv`    | `av1_qsv`    | mp4       | 10-bit, Intel Arc / Core Ultra         |
| `av1-svt`    | `libsvtav1`  | mp4       | 10-bit, CPU, slow at 4K                |
| `hevc-nvenc` | `hevc_nvenc` | mp4       | 10-bit, NVIDIA GTX 10 series or newer  |
| `h264-nvenc` | `h264_nvenc` | mp4       | Maximum compatibility, NVIDIA          |
| `h264-x264`  | `libx264`    | mp4       | Maximum compatibility, CPU             |
| `prores-hq`  | `prores_ks`  | mov       | Editing intermediate, very large files |
| `default`    | `libx264`    | avi       | Previous default settings              |

Recording behavior:

- `--window-mode normal|background|off-screen|hidden` (Windows): `background` (default) keeps the game window behind the
  other windows and gives the focus back to the previous window, `off-screen` also moves it outside of the screens,
  `hidden` (experimental) hides the window completely, some drivers stop rendering hidden windows: use `off-screen` if
  the recording stalls.
  The game keeps rendering at full speed and keeps its audio while unfocused.
- `--fast-seek` / `--no-fast-seek` (CS2, enabled by default): the demo is not restarted from the beginning between
  sequences. Short gaps are played, long gaps are skipped with a forward seek, overlapping sequences still restart the
  demo. Disable it if a sequence is missing in the output.
- `--hide-player-names all|others` (HLAE): replace players' names in the kill feed, `others` keeps the names of the
  `--steamids` players.
- `--close-game-after-recording` must stay enabled (default) when chaining videos, the queue waits for the game to exit.

Output: videos are written in `<output>/<video id>/`, one file per sequence named
`sequence-<number>-tick-<start>-to-<end>.<container>` (or a single file with `--concatenate-sequences`). The `done`
event lists the generated files.

Queue control: `csdm video list|pause|resume` (the queue is shared with the desktop app).

### JSON events of `video`

| `type`       | Payload                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analysis`   | `status` (`required`, `analyzing`, `inserting`, `success`, `skipped`), `demoPath`, `checksum`                                                               |
| `highlights` | `highlights[]` (`roundNumber`, `playerSteamId`, `killCount`, `score`, `startTick`, `endTick`, `clutch`)                                                     |
| `skipped`    | `demoPath`, `reason` (no sequences for this demo)                                                                                                           |
| `install`    | `software` (`HLAE`, `FFmpeg`, `VirtualDub`)                                                                                                                 |
| `preset`     | `id`, `name` (preset picked by `--preset auto`)                                                                                                             |
| `start`      | `demoPath`, `checksum`, `sequenceCount`, `sequences[]`, `width`, `height`, `framerate`, `videoCodec`...                                                     |
| `queued`     | `videoIds[]`                                                                                                                                                |
| `progress`   | `videoId`, `demoPath`, `status` (`recording`, `moving-files`, `converting`, `concatenating`), `currentSequence`, `currentSequencePosition`, `sequenceCount` |
| `done`       | `videoId`, `demoPath`, `outputFolderPath`, `files[]`                                                                                                        |
| `merging`    | `fileCount`, `outputFilePath`                                                                                                                               |
| `merged`     | `outputFilePath`                                                                                                                                            |
| `error`      | `message`, optional `videoId`, `demoPath`, `errorCode`, `details`                                                                                           |

During `recording`, `currentSequence` is the sequence being recorded (CS2), it's read from the CS:DM game plugin log.

## Tips

- 4K recordings on a lower resolution monitor: the game window can't always be larger than the desktop, enable
  NVIDIA DSR / AMD VSR (or record on a 4K display) to get real 4K frames.
- Linux: set "Launch command prefix" in the playback settings (e.g. `gamescope --backend headless -W 3840 -H 2160 --`)
  to record without a visible game window. Recording on Linux uses the CS recording system (TGA images), it needs a lot
  of free disk space at high resolutions.
- Keep Steam running and logged in, CS2 needs it.
