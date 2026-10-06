import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'fs-extra';
import { Command } from './command';
import { migrateSettings } from 'csdm/node/settings/migrate-settings';
import { getSettings } from 'csdm/node/settings/get-settings';
import { getDemoFromFilePath } from 'csdm/node/demo/get-demo-from-file-path';
import type { AddVideoPayload, Video } from 'csdm/common/types/video';
import { VideoStatus } from 'csdm/common/types/video-status';
import { EncoderSoftware } from 'csdm/common/types/encoder-software';
import { isValidEncoderSoftware } from 'csdm/common/types/encoder-software';
import { RecordingSystem } from 'csdm/common/types/recording-system';
import { isValidRecordingSystem } from 'csdm/common/types/recording-system';
import { RecordingOutput } from 'csdm/common/types/recording-output';
import { isValidRecordingOutput } from 'csdm/common/types/recording-output';
import type { VideoContainer } from 'csdm/common/types/video-container';
import { isValidVideoContainer } from 'csdm/common/types/video-container';
import { InvalidArgument } from 'csdm/cli/errors/invalid-argument';
import { isHlaeInstalled } from 'csdm/node/video/hlae/is-hlae-installed';
import { isVirtualDubInstalled } from 'csdm/node/video/virtual-dub/is-virtual-dub-installed';
import { isFfmpegInstalled } from 'csdm/node/video/ffmpeg/is-ffmpeg-installed';
import { fetchPlayer } from 'csdm/node/database/player/fetch-player';
import { CliClientMessageName } from 'csdm/server/messages/cli-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import type { CliWebSocketClient } from 'csdm/cli/web-socket/cli-web-socket-client';
import type { FfmpegSettings } from 'csdm/node/settings/settings';
import type { Sequence } from 'csdm/common/types/sequence';
import { isValidPlayerSequenceEvent, PlayerSequenceEvent } from 'csdm/common/types/player-sequence-event';
import type { PlayerSequenceEvent as PlayerSequenceEventType } from 'csdm/common/types/player-sequence-event';
import { isValidPerspective, Perspective } from 'csdm/common/types/perspective';
import { Perspective as PerspectiveType } from 'csdm/common/types/perspective';
import { buildPlayersEventSequences } from 'csdm/common/video/sequences/build-players-event-sequences';
import { buildPlayersRoundsSequences } from 'csdm/common/video/sequences/build-players-rounds-sequences';
import { isErrorCode } from 'csdm/common/is-error-code';
import { getErrorCodeMessage } from 'csdm/cli/get-error-code-message';
import { CliOutput } from 'csdm/cli/cli-output';
import { getOrAnalyzeMatch } from 'csdm/cli/get-or-analyze-match';
import { parseWeaponNames } from 'csdm/cli/parse-weapon-names';
import type { WeaponName } from 'csdm/common/types/counter-strike';
import {
  ffmpegPresets,
  getFfmpegPreset,
  isValidFfmpegPresetId,
  type FfmpegPresetId,
  type FfmpegPresetSettings,
} from 'csdm/node/video/ffmpeg/ffmpeg-presets';
import { detectBestAv1Preset } from 'csdm/node/video/ffmpeg/detect-ffmpeg-presets';
import { getFfmpegExecutablePathFromSettings } from 'csdm/node/video/ffmpeg/ffmpeg-location';
import { parseVideoResolution } from 'csdm/common/video/video-resolution-presets';
import { isValidRecordingWindowMode, RecordingWindowMode } from 'csdm/common/types/recording-window-mode';
import {
  buildHighlightsSequences,
  buildPlayerHighlights,
  keepBestHighlights,
  filterPlayerKills,
} from 'csdm/common/video/highlights/build-player-highlights';
import type { Match } from 'csdm/common/types/match';

export type VideoCommandConfig = {
  demoPath: string;
  recordingSystem?: RecordingSystem;
  recordingOutput?: RecordingOutput;
  encoderSoftware?: EncoderSoftware;
  framerate?: number;
  width?: number;
  height?: number;
  closeGameAfterRecording?: boolean;
  trueView: boolean;
  concatenateSequences?: boolean;
  outputFileName?: string;
  ffmpegSettings?: FfmpegSettings;
  outputFolderPath?: string;
  sequences?: Sequence[];
  // Encoding preset id or "auto" to use the fastest AV1 encoder available, ignored when ffmpegSettings is defined.
  ffmpegPreset?: FfmpegPresetId | 'auto';
  fastSeek?: boolean;
  windowMode?: RecordingWindowMode;
};

/**
 * The mode determines how video sequences are generated.
 * If no mode is specified, a single sequence from startTick to endTick is created.
 * - player: Generates sequences based on player events (kills, deaths, rounds)
 * - highlights: Generates one sequence per player's highlight (multi-kill rounds, won clutches...)
 */
const Mode = {
  Player: 'player',
  Highlights: 'highlights',
} as const;
type Mode = (typeof Mode)[keyof typeof Mode];

const QueueSubCommand = {
  List: 'list',
  Pause: 'pause',
  Resume: 'resume',
  Presets: 'presets',
} as const;
type QueueSubCommand = (typeof QueueSubCommand)[keyof typeof QueueSubCommand];

function isQueueSubCommand(arg: string | undefined): arg is QueueSubCommand {
  return Object.values(QueueSubCommand).includes(arg as QueueSubCommand);
}

type SequenceSettings = {
  showOnlyDeathNotices: boolean;
  showXRay: boolean;
  showAssists: boolean;
  recordAudio: boolean;
  playerVoicesEnabled: boolean;
  deathNoticesDuration: number;
};

export class VideoCommand extends Command {
  public static Name = 'video';
  private readonly outputFlag = 'output';
  private readonly framerateFlag = 'framerate';
  private readonly widthFlag = 'width';
  private readonly heightFlag = 'height';
  private readonly closeGameAfterRecordingFlag = 'close-game-after-recording';
  private readonly noCloseGameAfterRecordingFlag = 'no-close-game-after-recording';
  private readonly concatenateSequencesFlag = 'concatenate-sequences';
  private readonly noConcatenateSequencesFlag = 'no-concatenate-sequences';
  private readonly outputFileNameFlag = 'output-file-name';
  private readonly trueViewFlag = 'true-view';
  private readonly noTrueViewFlag = 'no-true-view';
  private readonly encoderSoftwareFlag = 'encoder-software';
  private readonly recordingSystemFlag = 'recording-system';
  private readonly recordingOutputFlag = 'recording-output';
  private readonly ffmpegExecutablePathFlag = 'ffmpeg-executable-path';
  private readonly ffmpegCrfFlag = 'ffmpeg-crf';
  private readonly ffmpegAudioBitrateFlag = 'ffmpeg-audio-bitrate';
  private readonly ffmpegVideoCodecFlag = 'ffmpeg-video-codec';
  private readonly ffmpegAudioCodecFlag = 'ffmpeg-audio-codec';
  private readonly ffmpegVideoContainerFlag = 'ffmpeg-video-container';
  private readonly ffmpegInputParametersFlag = 'ffmpeg-input-parameters';
  private readonly ffmpegOutputParametersFlag = 'ffmpeg-output-parameters';
  private readonly showXRayFlag = 'show-x-ray';
  private readonly noShowXRayFlag = 'no-show-x-ray';
  private readonly showAssistsFlag = 'show-assists';
  private readonly noShowAssistsFlag = 'no-show-assists';
  private readonly showOnlyDeathNoticesFlag = 'show-only-death-notices';
  private readonly noShowOnlyDeathNoticesFlag = 'no-show-only-death-notices';
  private readonly recordAudioFlag = 'record-audio';
  private readonly noRecordAudioFlag = 'no-record-audio';
  private readonly playerVoicesFlag = 'player-voices';
  private readonly noPlayerVoicesFlag = 'no-player-voices';
  private readonly deathNoticesDurationFlag = 'death-notices-duration';
  private readonly cfgFlag = 'cfg';
  private readonly focusPlayerFlag = 'focus-player';
  private readonly configFileFlag = 'config-file';
  private readonly modeFlag = 'mode';
  private readonly eventFlag = 'event';
  private readonly steamIdsFlag = 'steamids';
  private readonly perspectiveFlag = 'perspective';
  private readonly roundsFlag = 'rounds';
  private readonly startSecondsBeforeFlag = 'start-seconds-before';
  private readonly endSecondsAfterFlag = 'end-seconds-after';
  private readonly presetFlag = 'preset';
  private readonly resolutionFlag = 'resolution';
  private readonly fastSeekFlag = 'fast-seek';
  private readonly noFastSeekFlag = 'no-fast-seek';
  private readonly windowModeFlag = 'window-mode';
  private readonly weaponsFlag = 'weapons';
  private readonly headshotsOnlyFlag = 'headshots-only';
  private readonly minKillsInRoundFlag = 'min-kills-in-round';
  private readonly topFlag = 'top';
  private readonly noAnalyzeFlag = 'no-analyze';
  private readonly jsonFlag = 'json';
  private outputFolderPath: string | undefined;
  private demoPath: string = '';
  private startTick: number = 0;
  private endTick: number = 0;
  private framerate: number | undefined;
  private width: number | undefined;
  private height: number | undefined;
  private closeGameAfterRecording: boolean | undefined;
  private concatenateSequences: boolean | undefined;
  private outputFileName: string | undefined;
  private trueView: boolean | undefined;
  private encoderSoftware: EncoderSoftware | undefined;
  private recordingSystem: RecordingSystem | undefined;
  private recordingOutput: RecordingOutput | undefined;
  private ffmpegExecutablePath: string | undefined;
  private ffmpegCrf: number | undefined;
  private ffmpegAudioBitrate: number | undefined;
  private ffmpegVideoCodec: string | undefined;
  private ffmpegAudioCodec: string | undefined;
  private ffmpegVideoContainer: VideoContainer | undefined;
  private ffmpegInputParameters: string | undefined;
  private ffmpegOutputParameters: string | undefined;
  private showXRay: boolean | undefined;
  private showAssists: boolean | undefined;
  private showOnlyDeathNotices: boolean | undefined;
  private recordAudio: boolean | undefined;
  private playerVoices: boolean | undefined;
  private deathNoticesDuration: number | undefined;
  private cfg: string | undefined;
  private focusPlayerSteamId: string | undefined;
  private config: VideoCommandConfig | undefined;
  private mode: Mode | undefined;
  private steamIds: string[] = [];
  private event: PlayerSequenceEventType | undefined;
  private perspective: PerspectiveType = Perspective.Player;
  private rounds: number[] = [];
  private startSecondsBefore: number | undefined;
  private endSecondsAfter: number | undefined;
  private preset: FfmpegPresetId | 'auto' | undefined;
  private fastSeek: boolean | undefined;
  private windowMode: RecordingWindowMode | undefined;
  private weapons: WeaponName[] = [];
  private headshotsOnly = false;
  private minKillsInRound: number | undefined;
  private top: number | undefined;
  private analyze = true;
  private output = new CliOutput(false);

  public getDescription() {
    return 'Generate videos from demos and control the video generation queue.';
  }

  public printHelp() {
    console.log(this.getDescription());
    console.log('');
    console.log(`Usage: csdm ${VideoCommand.Name} <demoPath> <startTick> <endTick> [options]`);
    console.log(
      `       csdm ${VideoCommand.Name} <demoPath> --mode ${Mode.Player} --steamids <id1,id2> --event <event> [options]`,
    );
    console.log(`       csdm ${VideoCommand.Name} <demoPath> --mode ${Mode.Highlights} --steamids <id1,id2> [options]`);
    console.log(`       csdm ${VideoCommand.Name} <${Object.values(QueueSubCommand).join('|')}>`);
    console.log('');
    console.log('The demo is analyzed first if it is not in the database yet (disable it with --no-analyze).');
    console.log('');
    console.log('Example, record the best 10 highlights of a player in 4K 120 FPS AV1 without disturbing the user:');
    console.log(
      `  csdm ${VideoCommand.Name} demo.dem --mode ${Mode.Highlights} --steamids 76561198000000000 --top 10 --resolution 4k --framerate 120 --preset auto --window-mode background --json`,
    );
    console.log('');
    console.log('Videos are added to the generation queue shared with the GUI, the command waits for its video to');
    console.log('complete and pressing Ctrl+C aborts it. The queue itself can be controlled with the sub commands:');
    console.log(`  ${QueueSubCommand.List}: print the videos in the queue and whether the queue is paused.`);
    console.log(
      `  ${QueueSubCommand.Pause}: pause the queue, the video currently being generated completes before the queue stops.`,
    );
    console.log(`  ${QueueSubCommand.Resume}: resume the queue.`);
    console.log(`  ${QueueSubCommand.Presets}: print the FFmpeg encoding presets.`);
    console.log('');
    console.log('Options:');
    console.log(
      `  --${this.presetFlag} <${ffmpegPresets.map((preset) => preset.id).join('|')}|auto> (FFmpeg encoding preset, auto picks the fastest working AV1 encoder, --ffmpeg-* options override it)`,
    );
    console.log(`  --${this.resolutionFlag} <720p|1080p|1440p|4k|<width>x<height>>`);
    console.log(`  --${this.fastSeekFlag} (CS2, jump to the next sequence without restarting the demo)`);
    console.log(`  --${this.noFastSeekFlag}`);
    console.log(
      `  --${this.windowModeFlag} <${Object.values(RecordingWindowMode).join('|')}> (Windows, keep the game window behind other windows or off-screen)`,
    );
    console.log(`  --${this.noAnalyzeFlag} (fail instead of analyzing the demo when it's not in the database)`);
    console.log(`  --${this.jsonFlag} (print newline-delimited JSON events, the last one is "done" or "error")`);
    console.log(`  --${this.framerateFlag} <number>`);
    console.log(`  --${this.widthFlag} <number>`);
    console.log(`  --${this.heightFlag} <number>`);
    console.log(`  --${this.closeGameAfterRecordingFlag}`);
    console.log(`  --${this.noCloseGameAfterRecordingFlag}`);
    console.log(`  --${this.concatenateSequencesFlag}`);
    console.log(`  --${this.noConcatenateSequencesFlag}`);
    console.log(`  --${this.outputFileNameFlag} <string>`);
    console.log(`  --${this.encoderSoftwareFlag} <string> (FFmpeg or VirtualDub)`);
    console.log(`  --${this.recordingSystemFlag} <string> (HLAE or CS)`);
    console.log(`  --${this.recordingOutputFlag} <string> (video, images, or images-and-video)`);
    console.log(`  --${this.ffmpegExecutablePathFlag} <string> (path to FFmpeg executable)`);
    console.log(`  --${this.ffmpegCrfFlag} <number>`);
    console.log(`  --${this.ffmpegAudioBitrateFlag} <number>`);
    console.log(`  --${this.ffmpegVideoCodecFlag} <string>`);
    console.log(`  --${this.ffmpegAudioCodecFlag} <string>`);
    console.log(`  --${this.ffmpegVideoContainerFlag} <string> (mp4, avi, mkv or mov)`);
    console.log(`  --${this.ffmpegInputParametersFlag} <string>`);
    console.log(`  --${this.ffmpegOutputParametersFlag} <string>`);
    console.log(`  --${this.showXRayFlag}`);
    console.log(`  --${this.noShowXRayFlag}`);
    console.log(`  --${this.showAssistsFlag}`);
    console.log(`  --${this.noShowAssistsFlag}`);
    console.log(`  --${this.showOnlyDeathNoticesFlag}`);
    console.log(`  --${this.noShowOnlyDeathNoticesFlag}`);
    console.log(`  --${this.playerVoicesFlag}`);
    console.log(`  --${this.noPlayerVoicesFlag}`);
    console.log(`  --${this.recordAudioFlag}`);
    console.log(`  --${this.noRecordAudioFlag}`);
    console.log(`  --${this.deathNoticesDurationFlag} <number>`);
    console.log(`  --${this.trueViewFlag}`);
    console.log(`  --${this.noTrueViewFlag}`);
    console.log(`  --${this.cfgFlag} <string>`);
    console.log(`  --${this.focusPlayerFlag} <steamId>`);
    console.log(`  --${this.configFileFlag} <path> (path to config JSON file)`);
    console.log(`  --${this.outputFlag} <path> (output folder for generated videos)`);
    console.log(`  --verbose`);
    console.log('');
    console.log(`Player mode options (when --mode ${Mode.Player}):`);
    console.log(`  --${this.eventFlag} <string> (${Object.values(PlayerSequenceEvent).join('|')})`);
    console.log(`  --${this.steamIdsFlag} <steamId1,steamId2,...> (comma-separated list of Steam IDs)`);
    console.log(
      `  --${this.perspectiveFlag} <string> (${Object.values(PerspectiveType).join('|')}, default: ${PerspectiveType.Player})`,
    );
    console.log(`  --${this.roundsFlag} <number,number,...> (comma-separated list of round numbers to filter)`);
    console.log(`  --${this.weaponsFlag} <ak47,awp,...> (kills event only, only kills done with these weapons)`);
    console.log(`  --${this.headshotsOnlyFlag} (kills event only, only headshot kills)`);
    console.log(`  --${this.startSecondsBeforeFlag} <number> (seconds before event to start sequence, default: 2)`);
    console.log(`  --${this.endSecondsAfterFlag} <number> (seconds after event to end sequence, default: 2)`);
    console.log('');
    console.log(`Highlights mode options (when --mode ${Mode.Highlights}):`);
    console.log(`  --${this.steamIdsFlag} <steamId1,steamId2,...> (players to record)`);
    console.log(`  --${this.minKillsInRoundFlag} <number> (ignore rounds with less kills, won clutches are kept)`);
    console.log(`  --${this.topFlag} <number> (keep only the N highlights with the best score)`);
    console.log(`  --${this.roundsFlag}, --${this.weaponsFlag}, --${this.headshotsOnlyFlag} (same as player mode)`);
    console.log(
      `  --${this.startSecondsBeforeFlag} <number> (default: 3), --${this.endSecondsAfterFlag} <number> (default: 2)`,
    );
    console.log('');
    console.log(
      `Run "csdm highlights" to preview highlights and "csdm doctor" to list the encoding presets that work.`,
    );
  }

  public async run() {
    const [firstArg] = this.args;
    this.output = new CliOutput(this.args.includes(`--${this.jsonFlag}`));
    if (isQueueSubCommand(firstArg)) {
      return this.runQueueSubCommand(firstArg);
    }

    try {
      await this.parseArgs();
      await this.initDatabaseConnection();
      await migrateSettings();

      const settings = await getSettings();
      const demo = await getDemoFromFilePath(this.demoPath);
      const resolution = { width: this.width ?? settings.video.width, height: this.height ?? settings.video.height };

      let parameters: AddVideoPayload = {
        demoPath: this.demoPath,
        // The queue nests the video output in a folder named after the video id.
        outputFolderPath: this.outputFolderPath ?? path.dirname(this.demoPath),
        checksum: demo.checksum,
        game: demo.game,
        mapName: demo.mapName,
        tickrate: demo.tickrate,
        recordingSystem: this.recordingSystem ?? settings.video.recordingSystem,
        recordingOutput: this.recordingOutput ?? settings.video.recordingOutput,
        encoderSoftware: this.encoderSoftware ?? settings.video.encoderSoftware,
        framerate: this.framerate ?? settings.video.framerate,
        width: resolution.width,
        height: resolution.height,
        closeGameAfterRecording: this.closeGameAfterRecording ?? settings.video.closeGameAfterRecording,
        concatenateSequences: this.concatenateSequences ?? settings.video.concatenateSequences,
        outputFileName: this.outputFileName ?? settings.video.outputFileName,
        trueView: this.trueView ?? settings.video.trueView,
        fastSeek: this.fastSeek ?? settings.video.fastSeek ?? true,
        windowMode: this.windowMode ?? settings.video.windowMode ?? RecordingWindowMode.Normal,
        sequences: [],
        ffmpegSettings: {
          ...settings.video.ffmpegSettings,
          customLocationEnabled:
            this.ffmpegExecutablePath !== undefined ? true : settings.video.ffmpegSettings.customLocationEnabled,
          customExecutableLocation: this.ffmpegExecutablePath ?? settings.video.ffmpegSettings.customExecutableLocation,
        },
      };
      let preset = this.preset;

      const config = this.config;
      const sequenceSettings = {
        showOnlyDeathNotices: this.showOnlyDeathNotices ?? settings.video.showOnlyDeathNotices,
        showXRay: this.showXRay ?? settings.video.showXRay,
        showAssists: this.showAssists ?? settings.video.showAssists,
        recordAudio: this.recordAudio ?? settings.video.recordAudio,
        playerVoicesEnabled: this.playerVoices ?? settings.video.playerVoicesEnabled,
        deathNoticesDuration: this.deathNoticesDuration ?? settings.video.deathNoticesDuration,
      };
      if (config) {
        parameters = {
          ...parameters,
          recordingSystem: config.recordingSystem ?? parameters.recordingSystem,
          recordingOutput: config.recordingOutput ?? parameters.recordingOutput,
          encoderSoftware: config.encoderSoftware ?? parameters.encoderSoftware,
          framerate: config.framerate ?? parameters.framerate,
          width: config.width ?? parameters.width,
          height: config.height ?? parameters.height,
          trueView: config.trueView ?? parameters.trueView,
          fastSeek: config.fastSeek ?? parameters.fastSeek,
          windowMode: config.windowMode ?? parameters.windowMode,
          closeGameAfterRecording: config.closeGameAfterRecording ?? parameters.closeGameAfterRecording,
          concatenateSequences: config.concatenateSequences ?? parameters.concatenateSequences,
          outputFileName: config.outputFileName ?? parameters.outputFileName,
          ffmpegSettings: config.ffmpegSettings ?? parameters.ffmpegSettings,
          outputFolderPath: config.outputFolderPath ?? parameters.outputFolderPath,
          sequences: config.sequences ?? parameters.sequences,
        };
        if (config.ffmpegSettings === undefined) {
          preset = preset ?? config.ffmpegPreset;
        }
      } else if (this.mode === Mode.Player || this.mode === Mode.Highlights) {
        if (this.steamIds.length === 0) {
          throw new InvalidArgument(`--${this.steamIdsFlag} is required for ${this.mode} mode`);
        }

        const { match } = await getOrAnalyzeMatch({
          demoPath: this.demoPath,
          output: this.output,
          analyze: this.analyze,
          connectToDaemon: () => this.connectToDaemon(),
        });

        parameters.sequences =
          this.mode === Mode.Highlights
            ? this.buildHighlightsSequences(match, sequenceSettings)
            : this.buildPlayerSequences(match, sequenceSettings);

        if (parameters.sequences.length === 0) {
          throw new Error('No sequences generated. Check that the players have matching events in the demo.');
        }
      } else {
        const player = this.focusPlayerSteamId ? await fetchPlayer(this.focusPlayerSteamId) : undefined;
        parameters.sequences = [
          {
            number: 1,
            startTick: this.startTick,
            endTick: this.endTick,
            showXRay: sequenceSettings.showXRay,
            showAssists: sequenceSettings.showAssists,
            showOnlyDeathNotices: sequenceSettings.showOnlyDeathNotices,
            playersOptions: [],
            cameras: [],
            recordAudio: sequenceSettings.recordAudio,
            playerCameras: player
              ? [
                  {
                    tick: this.startTick,
                    playerSteamId: player.steamId,
                    playerName: player.name,
                  },
                ]
              : [],
            playerVoicesEnabled: sequenceSettings.playerVoicesEnabled,
            deathNoticesDuration: sequenceSettings.deathNoticesDuration,
            cfg: this.cfg,
          },
        ];
      }

      const client = await this.connectToDaemon();
      await this.installDependenciesIfNecessary(client, parameters);

      if (!config?.ffmpegSettings) {
        const presetSettings = await this.resolvePresetSettings(preset, parameters);
        parameters.ffmpegSettings = this.applyFfmpegFlags({ ...parameters.ffmpegSettings, ...presetSettings });
      }

      this.output.event('start', {
        demoPath: parameters.demoPath,
        checksum: parameters.checksum,
        sequenceCount: parameters.sequences.length,
        sequences: parameters.sequences.map(({ number, startTick, endTick }) => ({ number, startTick, endTick })),
        width: parameters.width,
        height: parameters.height,
        framerate: parameters.framerate,
        recordingSystem: parameters.recordingSystem,
        videoCodec: parameters.ffmpegSettings.videoCodec,
        videoContainer: parameters.ffmpegSettings.videoContainer,
      });

      const video = await client.send(
        {
          name: CliClientMessageName.AddVideoToQueue,
          payload: parameters,
        },
        { timeoutMs: 30_000 },
      );

      await this.waitForVideoGeneration(client, video);
      client.close();
    } catch (error) {
      if (error instanceof Error) {
        this.output.error(error.message);
        if (error instanceof InvalidArgument && !this.output.isJson) {
          this.printHelp();
        }
      } else if (isErrorCode(error)) {
        this.output.error(getErrorCodeMessage(error), { errorCode: error });
      } else {
        this.output.error(String(error));
      }
      this.exitWithFailure();
    }
  }

  private buildPlayerSequences(match: Match, sequenceSettings: SequenceSettings): Sequence[] {
    if (!this.event) {
      throw new InvalidArgument(`--${this.eventFlag} is required for player mode`);
    }

    const startSecondsBeforeEvent = this.startSecondsBefore ?? 2;
    const endSecondsAfterEvent = this.endSecondsAfter ?? 2;
    if (this.event === PlayerSequenceEvent.Rounds) {
      return buildPlayersRoundsSequences({
        match,
        steamIds: this.steamIds,
        rounds: this.rounds,
        startSecondsBeforeEvent,
        endSecondsAfterEvent,
        settings: sequenceSettings,
        firstSequenceNumber: 1,
      });
    }

    let filteredMatch = match;
    if (this.event === PlayerSequenceEvent.Kills && this.headshotsOnly) {
      filteredMatch = {
        ...match,
        kills: filterPlayerKills(match.kills, { steamIds: this.steamIds, headshotsOnly: true }),
      };
    }

    return buildPlayersEventSequences({
      event: this.event,
      match: filteredMatch,
      steamIds: this.steamIds,
      rounds: this.rounds,
      perspective: this.perspective,
      startSecondsBeforeEvent,
      endSecondsAfterEvent,
      settings: sequenceSettings,
      weapons: this.weapons,
      firstSequenceNumber: 1,
    });
  }

  private buildHighlightsSequences(match: Match, sequenceSettings: SequenceSettings): Sequence[] {
    let highlights = buildPlayerHighlights({
      match,
      steamIds: this.steamIds,
      minKillsInRound: this.minKillsInRound,
      rounds: this.rounds,
      weapons: this.weapons,
      headshotsOnly: this.headshotsOnly,
      startSecondsBeforeEvent: this.startSecondsBefore ?? 3,
      endSecondsAfterEvent: this.endSecondsAfter ?? 2,
    });
    if (this.top !== undefined) {
      highlights = keepBestHighlights(highlights, this.top);
    }

    this.output.logOrEvent(`${highlights.length} highlights found`, 'highlights', {
      highlights: highlights.map(({ roundNumber, playerSteamId, killCount, score, startTick, endTick, clutch }) => {
        return { roundNumber, playerSteamId, killCount, score, startTick, endTick, clutch };
      }),
    });

    return buildHighlightsSequences({ highlights, match, settings: sequenceSettings });
  }

  private async resolvePresetSettings(
    preset: FfmpegPresetId | 'auto' | undefined,
    parameters: AddVideoPayload,
  ): Promise<FfmpegPresetSettings | undefined> {
    if (preset === undefined) {
      return undefined;
    }

    if (preset !== 'auto') {
      return getFfmpegPreset(preset).settings;
    }

    this.output.log('Detecting the best AV1 encoder...');
    const ffmpegExecutablePath = getFfmpegExecutablePathFromSettings(parameters.ffmpegSettings);
    const bestPreset = await detectBestAv1Preset(ffmpegExecutablePath);
    if (!bestPreset) {
      throw new Error('No working AV1 encoder found, run "csdm doctor" for details.');
    }
    this.output.logOrEvent(`Using the encoding preset ${bestPreset.id} (${bestPreset.name})`, 'preset', {
      id: bestPreset.id,
      name: bestPreset.name,
    });

    return bestPreset.settings;
  }

  // Explicit --ffmpeg-* flags have priority over the settings and the preset.
  private applyFfmpegFlags(ffmpegSettings: FfmpegSettings): FfmpegSettings {
    return {
      ...ffmpegSettings,
      audioBitrate: this.ffmpegAudioBitrate ?? ffmpegSettings.audioBitrate,
      constantRateFactor: this.ffmpegCrf ?? ffmpegSettings.constantRateFactor,
      videoCodec: this.ffmpegVideoCodec ?? ffmpegSettings.videoCodec,
      audioCodec: this.ffmpegAudioCodec ?? ffmpegSettings.audioCodec,
      videoContainer: this.ffmpegVideoContainer ?? ffmpegSettings.videoContainer,
      inputParameters: this.ffmpegInputParameters ?? ffmpegSettings.inputParameters,
      outputParameters: this.ffmpegOutputParameters ?? ffmpegSettings.outputParameters,
    };
  }

  private async runQueueSubCommand(subCommand: QueueSubCommand) {
    if (subCommand === QueueSubCommand.Presets) {
      this.output.result(ffmpegPresets, () => {
        return ffmpegPresets.map((preset) => {
          const { videoCodec, videoContainer, outputParameters } = preset.settings;
          return `${preset.id.padEnd(12)} ${preset.name} (${preset.requirement})\n${' '.repeat(13)}${videoContainer} -c:v ${videoCodec} ${outputParameters}`;
        });
      });
      return;
    }

    const client = await this.connectToDaemon();

    switch (subCommand) {
      case QueueSubCommand.Pause:
        await client.send({ name: CliClientMessageName.PauseVideoQueue });
        this.output.logOrEvent(
          'Video queue paused, the video currently being generated will complete before the queue stops.',
          'queue',
          { isPaused: true },
        );
        break;
      case QueueSubCommand.Resume:
        await client.send({ name: CliClientMessageName.ResumeVideoQueue });
        this.output.logOrEvent('Video queue resumed', 'queue', { isPaused: false });
        break;
      case QueueSubCommand.List: {
        const { videos, isPaused } = await client.send({ name: CliClientMessageName.GetVideoQueue });
        this.output.result(
          {
            isPaused,
            videos: videos.map((video) => {
              return {
                id: video.id,
                status: video.status,
                demoPath: video.demoPath,
                outputFolderPath: video.outputFolderPath,
                sequenceCount: video.sequences.length,
              };
            }),
          },
          () => {
            const lines = [`The queue is ${isPaused ? 'paused' : 'running'}`];
            if (videos.length === 0) {
              lines.push('No videos in the queue');
            }
            for (const video of videos) {
              lines.push(
                `${video.id} ${video.status} ${path.basename(video.demoPath)} (${video.sequences.length} sequences)`,
              );
            }

            return lines;
          },
        );
        break;
      }
    }

    client.close();
  }

  private async installDependenciesIfNecessary(client: CliWebSocketClient, parameters: AddVideoPayload) {
    const installTimeout = { timeoutMs: 300_000 };
    if (parameters.recordingSystem === RecordingSystem.HLAE && !(await isHlaeInstalled())) {
      this.output.logOrEvent('Installing HLAE...', 'install', { software: 'HLAE' });
      await client.send({ name: CliClientMessageName.InstallHlae }, installTimeout);
    }

    const shouldGenerateVideo = parameters.recordingOutput !== RecordingOutput.Images;
    if (!shouldGenerateVideo) {
      return;
    }

    const { encoderSoftware } = parameters;
    if (encoderSoftware === EncoderSoftware.VirtualDub && !(await isVirtualDubInstalled())) {
      this.output.logOrEvent('Installing VirtualDub...', 'install', { software: 'VirtualDub' });
      await client.send({ name: CliClientMessageName.InstallVirtualDub }, installTimeout);
    }

    const needsFfmpeg =
      encoderSoftware === EncoderSoftware.FFmpeg || parameters.concatenateSequences || this.preset === 'auto';
    if (needsFfmpeg && typeof this.ffmpegExecutablePath !== 'string' && !(await isFfmpegInstalled())) {
      this.output.logOrEvent('Installing FFmpeg...', 'install', { software: 'FFmpeg' });
      await client.send({ name: CliClientMessageName.InstallFfmpeg }, installTimeout);
    }
  }

  private async waitForVideoGeneration(client: CliWebSocketClient, video: Video) {
    let resolveCompletion: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    let hasError = false;
    let lastPrintedProgress = '';
    let outputFolderPath = video.outputFolderPath;

    const onVideoUpdated = (updatedVideo: Video) => {
      if (updatedVideo.id !== video.id) {
        return;
      }

      const progress = `${updatedVideo.status}:${updatedVideo.currentSequence ?? ''}`;
      if (progress === lastPrintedProgress) {
        return;
      }
      lastPrintedProgress = progress;
      outputFolderPath = updatedVideo.outputFolderPath;
      const progressEvent = {
        videoId: updatedVideo.id,
        status: updatedVideo.status,
        currentSequence: updatedVideo.currentSequence,
        currentSequencePosition: updatedVideo.currentSequencePosition,
        sequenceCount: updatedVideo.sequences.length,
      };

      switch (updatedVideo.status) {
        case VideoStatus.Recording:
          this.output.logOrEvent('Recording in progress...', 'progress', progressEvent);
          break;
        case VideoStatus.MovingFiles:
          this.output.logOrEvent('Moving files...', 'progress', progressEvent);
          break;
        case VideoStatus.Converting:
          this.output.logOrEvent(
            `Converting sequence #${updatedVideo.currentSequence} (${updatedVideo.currentSequencePosition}/${updatedVideo.sequences.length})...`,
            'progress',
            progressEvent,
          );
          break;
        case VideoStatus.Concatenating:
          this.output.logOrEvent('Concatenating sequences...', 'progress', progressEvent);
          break;
        case VideoStatus.Success:
          resolveCompletion();
          break;
        case VideoStatus.Error:
          hasError = true;
          this.output.error('Error while generating the video', {
            videoId: updatedVideo.id,
            errorCode: updatedVideo.errorCode,
            details: updatedVideo.output,
          });
          if (!this.output.isJson) {
            if (updatedVideo.errorCode !== undefined) {
              console.error(getErrorCodeMessage(updatedVideo.errorCode));
            }
            if (updatedVideo.output !== '') {
              console.error(updatedVideo.output);
            }
          }
          resolveCompletion();
          break;
      }
    };

    const onVideosRemovedFromQueue = (removedVideoIds: string[]) => {
      if (removedVideoIds.includes(video.id)) {
        hasError = true;
        this.output.error('The video has been removed from the queue', { videoId: video.id });
        resolveCompletion();
      }
    };

    client.on(ServerPushMessageName.VideoUpdated, onVideoUpdated);
    client.on(ServerPushMessageName.VideosRemovedFromQueue, onVideosRemovedFromQueue);

    // The queue starts paused: resuming it starts the generation, processing any video queued before this one first.
    await client.send({ name: CliClientMessageName.ResumeVideoQueue });
    this.output.logOrEvent('Waiting for the video generation...', 'queued', { videoId: video.id });

    await completion;

    if (hasError) {
      this.exitWithFailure();
    }

    const files = await this.listOutputFiles(outputFolderPath);
    this.output.logOrEvent(`Video generated in ${outputFolderPath}`, 'done', {
      videoId: video.id,
      outputFolderPath,
      files,
    });
  }

  // Returns the absolute paths of the files generated in the video output folder (videos or raw files folders).
  private async listOutputFiles(outputFolderPath: string) {
    try {
      const entries = await fs.readdir(outputFolderPath, { withFileTypes: true });
      return entries
        .map((entry) => path.join(outputFolderPath, entry.name))
        .sort((pathA, pathB) => pathA.localeCompare(pathB, undefined, { numeric: true }));
    } catch {
      return [];
    }
  }

  protected async parseArgs() {
    super.parseArgs(this.args);
    const { values, positionals } = parseArgs({
      options: {
        ...this.commonArgs,
        [this.outputFlag]: { type: 'string', short: 'o' },
        [this.framerateFlag]: { type: 'string' },
        [this.widthFlag]: { type: 'string' },
        [this.heightFlag]: { type: 'string' },
        [this.closeGameAfterRecordingFlag]: { type: 'boolean' },
        [this.noCloseGameAfterRecordingFlag]: { type: 'boolean' },
        [this.concatenateSequencesFlag]: { type: 'boolean' },
        [this.noConcatenateSequencesFlag]: { type: 'boolean' },
        [this.outputFileNameFlag]: { type: 'string' },
        [this.encoderSoftwareFlag]: { type: 'string' },
        [this.recordingSystemFlag]: { type: 'string' },
        [this.recordingOutputFlag]: { type: 'string' },
        [this.ffmpegExecutablePathFlag]: { type: 'string' },
        [this.ffmpegCrfFlag]: { type: 'string' },
        [this.ffmpegAudioBitrateFlag]: { type: 'string' },
        [this.ffmpegVideoCodecFlag]: { type: 'string' },
        [this.ffmpegAudioCodecFlag]: { type: 'string' },
        [this.ffmpegVideoContainerFlag]: { type: 'string' },
        [this.ffmpegInputParametersFlag]: { type: 'string' },
        [this.ffmpegOutputParametersFlag]: { type: 'string' },
        [this.trueViewFlag]: { type: 'boolean' },
        [this.noTrueViewFlag]: { type: 'boolean' },
        [this.showXRayFlag]: { type: 'boolean' },
        [this.noShowXRayFlag]: { type: 'boolean' },
        [this.showAssistsFlag]: { type: 'boolean' },
        [this.noShowAssistsFlag]: { type: 'boolean' },
        [this.showOnlyDeathNoticesFlag]: { type: 'boolean' },
        [this.noShowOnlyDeathNoticesFlag]: { type: 'boolean' },
        [this.recordAudioFlag]: { type: 'boolean' },
        [this.noRecordAudioFlag]: { type: 'boolean' },
        [this.playerVoicesFlag]: { type: 'boolean' },
        [this.noPlayerVoicesFlag]: { type: 'boolean' },
        [this.deathNoticesDurationFlag]: { type: 'string' },
        [this.cfgFlag]: { type: 'string' },
        [this.focusPlayerFlag]: { type: 'string' },
        [this.configFileFlag]: { type: 'string', short: 'c' },
        [this.modeFlag]: { type: 'string' },
        [this.steamIdsFlag]: { type: 'string' },
        [this.eventFlag]: { type: 'string' },
        [this.perspectiveFlag]: { type: 'string' },
        [this.roundsFlag]: { type: 'string' },
        [this.startSecondsBeforeFlag]: { type: 'string' },
        [this.endSecondsAfterFlag]: { type: 'string' },
        [this.presetFlag]: { type: 'string' },
        [this.resolutionFlag]: { type: 'string' },
        [this.fastSeekFlag]: { type: 'boolean' },
        [this.noFastSeekFlag]: { type: 'boolean' },
        [this.windowModeFlag]: { type: 'string' },
        [this.weaponsFlag]: { type: 'string' },
        [this.headshotsOnlyFlag]: { type: 'boolean' },
        [this.minKillsInRoundFlag]: { type: 'string' },
        [this.topFlag]: { type: 'string' },
        [this.noAnalyzeFlag]: { type: 'boolean' },
        [this.jsonFlag]: { type: 'boolean' },
      },
      allowPositionals: true,
      args: this.args,
    });

    this.parseRecordingOptions(values);

    const configFilePath = values[this.configFileFlag];
    if (configFilePath) {
      try {
        const json = await fs.readFile(configFilePath, { encoding: 'utf8' });
        const matchHashComment = new RegExp(/(#.*)/, 'gi');
        // Remove comments (//, /* */ and #) from JSONC file
        const commentFreeJson = json
          .replace(matchHashComment, '')
          .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
          .trim();
        this.config = JSON.parse(commentFreeJson) as VideoCommandConfig;

        const { demoPath } = this.config;
        if (typeof demoPath !== 'string' || !demoPath.endsWith('.dem')) {
          throw new InvalidArgument('Invalid demo path');
        }
        this.demoPath = path.resolve(demoPath);
        return;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new Error(`Config file not found "${configFilePath}"`, { cause: error });
        }
        throw new Error('Failed to read or parse config file', { cause: error });
      }
    }

    if (positionals.length === 0) {
      throw new InvalidArgument('Missing demo path');
    }

    const [demoPath] = positionals;
    if (typeof demoPath !== 'string' || !demoPath.endsWith('.dem')) {
      throw new InvalidArgument('Invalid demo path');
    }
    this.demoPath = path.resolve(demoPath);

    const mode = values[this.modeFlag];
    if (typeof mode === 'string') {
      if (mode !== Mode.Player && mode !== Mode.Highlights) {
        throw new InvalidArgument(`Invalid mode. Supported values: ${Object.values(Mode).join(', ')}`);
      }
      this.mode = mode;

      const steamIdsValue = values[this.steamIdsFlag];
      if (typeof steamIdsValue !== 'string') {
        throw new InvalidArgument(`The --${this.steamIdsFlag} option is required for ${mode} mode`);
      }
      this.steamIds = steamIdsValue
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
      if (this.steamIds.length === 0) {
        throw new InvalidArgument('At least one Steam ID must be provided');
      }

      const eventValue = values[this.eventFlag];
      if (mode === Mode.Player) {
        if (typeof eventValue !== 'string') {
          throw new InvalidArgument(`The --${this.eventFlag} option is required for player mode`);
        }
        if (!isValidPlayerSequenceEvent(eventValue)) {
          throw new InvalidArgument(
            `Invalid event. Supported values: ${Object.values(PlayerSequenceEvent).join(', ')}`,
          );
        }
        this.event = eventValue;
      }

      const weaponsValue = values[this.weaponsFlag];
      if (typeof weaponsValue === 'string') {
        this.weapons = parseWeaponNames(weaponsValue);
      }
      this.headshotsOnly = values[this.headshotsOnlyFlag] === true;
      this.minKillsInRound = this.parsePositiveIntegerFlag(values[this.minKillsInRoundFlag], this.minKillsInRoundFlag);
      this.top = this.parsePositiveIntegerFlag(values[this.topFlag], this.topFlag);

      const perspectiveValue = values[this.perspectiveFlag];
      if (typeof perspectiveValue === 'string') {
        if (!isValidPerspective(perspectiveValue)) {
          throw new InvalidArgument(`Invalid perspective. Supported values: ${Object.values(Perspective).join(', ')}`);
        }
        this.perspective = perspectiveValue;
      }

      const roundsValue = values[this.roundsFlag];
      if (typeof roundsValue === 'string') {
        const rounds = roundsValue.split(',').map((value) => {
          const number = Number(value.trim());
          if (Number.isNaN(number) || number < 1) {
            throw new InvalidArgument(`Invalid round number: ${value}`);
          }
          return number;
        });
        this.rounds = rounds;
      }

      const startSecondsBeforeValue = values[this.startSecondsBeforeFlag];
      if (typeof startSecondsBeforeValue === 'string') {
        const seconds = Number(startSecondsBeforeValue);
        if (Number.isNaN(seconds) || seconds < 0) {
          throw new InvalidArgument('Start seconds before must be a non-negative number');
        }
        this.startSecondsBefore = seconds;
      }

      const endSecondsAfterValue = values[this.endSecondsAfterFlag];
      if (typeof endSecondsAfterValue === 'string') {
        const seconds = Number(endSecondsAfterValue);
        if (Number.isNaN(seconds) || seconds < 0) {
          throw new InvalidArgument('End seconds after must be a non-negative number');
        }
        this.endSecondsAfter = seconds;
      }
    } else {
      if (positionals.length < 3) {
        throw new InvalidArgument('Missing arguments');
      }

      const startTick = Number(positionals[1]);
      if (Number.isNaN(startTick)) {
        throw new InvalidArgument('Start tick is invalid');
      }
      if (startTick < 0) {
        throw new InvalidArgument('Start tick must be a positive number');
      }
      this.startTick = startTick;

      const endTick = Number(positionals[2]);
      if (Number.isNaN(endTick)) {
        throw new InvalidArgument('End tick is invalid');
      }
      if (endTick < 0) {
        throw new InvalidArgument('End tick must be a positive number');
      }
      if (endTick <= startTick) {
        throw new InvalidArgument('End tick must be greater than start tick');
      }
      this.endTick = endTick;
    }

    const outputFolderPath = values[this.outputFlag];
    if (outputFolderPath) {
      try {
        const stats = await fs.stat(outputFolderPath);
        if (!stats.isDirectory()) {
          throw new InvalidArgument('Output folder is not a directory');
        }
        this.outputFolderPath = outputFolderPath;
      } catch (error) {
        if (error instanceof InvalidArgument) {
          throw error;
        }
        throw new InvalidArgument('Output folder does not exist');
      }
    }
    if (values[this.framerateFlag]) {
      const framerate = Number(values[this.framerateFlag]);
      if (Number.isNaN(framerate)) {
        throw new InvalidArgument('Framerate is not a number');
      }
      if (framerate < 0) {
        throw new InvalidArgument('Framerate must be a positive number');
      }
      this.framerate = framerate;
    }
    const resolutionValue = values[this.resolutionFlag];
    if (typeof resolutionValue === 'string') {
      const resolution = parseVideoResolution(resolutionValue);
      if (!resolution || resolution.width < 800 || resolution.height < 600) {
        throw new InvalidArgument('Invalid resolution, use 720p, 1080p, 1440p, 4k or <width>x<height> (min 800x600)');
      }
      this.width = resolution.width;
      this.height = resolution.height;
    }
    if (values[this.widthFlag]) {
      const width = Number(values[this.widthFlag]);
      if (Number.isNaN(width)) {
        throw new InvalidArgument('Width is not a number');
      }
      if (width < 800) {
        throw new InvalidArgument('Width must be at least 800');
      }
      this.width = width;
    }
    if (values[this.heightFlag]) {
      const height = Number(values[this.heightFlag]);
      if (Number.isNaN(height)) {
        throw new InvalidArgument('Height is not a number');
      }
      if (height < 600) {
        throw new InvalidArgument('Height must be at least 600');
      }
      this.height = height;
    }
    const closeGameAfterRecording = values[this.closeGameAfterRecordingFlag];
    if (closeGameAfterRecording !== undefined) {
      this.closeGameAfterRecording = true;
    }
    const noCloseGameAfterRecording = values[this.noCloseGameAfterRecordingFlag];
    if (noCloseGameAfterRecording !== undefined) {
      this.closeGameAfterRecording = false;
    }
    const concatenateSequences = values[this.concatenateSequencesFlag];
    if (concatenateSequences !== undefined) {
      this.concatenateSequences = true;
    }
    const noConcatenateSequences = values[this.noConcatenateSequencesFlag];
    if (noConcatenateSequences !== undefined) {
      this.concatenateSequences = false;
    }
    const outputFileName = values[this.outputFileNameFlag];
    if (typeof outputFileName === 'string') {
      this.outputFileName = outputFileName;
    }
    const encoderSoftware = values[this.encoderSoftwareFlag];
    if (encoderSoftware !== undefined) {
      if (!isValidEncoderSoftware(encoderSoftware)) {
        throw new InvalidArgument('Invalid encoder software');
      }
      this.encoderSoftware = encoderSoftware;
    }
    const recordingSystem = values[this.recordingSystemFlag];
    if (recordingSystem !== undefined) {
      if (!isValidRecordingSystem(recordingSystem)) {
        throw new InvalidArgument('Invalid recording system');
      }
      this.recordingSystem = recordingSystem;
    }
    const recordingOutput = values[this.recordingOutputFlag];
    if (recordingOutput !== undefined) {
      if (!isValidRecordingOutput(recordingOutput)) {
        throw new InvalidArgument('Invalid recording output');
      }
      this.recordingOutput = recordingOutput;
    }
    const ffmpegExecutablePath = values[this.ffmpegExecutablePathFlag];
    if (typeof ffmpegExecutablePath === 'string') {
      const ffmpegExecutableExists = await fs.pathExists(ffmpegExecutablePath);
      if (!ffmpegExecutableExists) {
        throw new InvalidArgument('FFmpeg executable path does not exist');
      }
      this.ffmpegExecutablePath = ffmpegExecutablePath;
    }
    if (values[this.ffmpegCrfFlag] !== undefined) {
      const ffmpegCrf = Number(values[this.ffmpegCrfFlag]);
      if (Number.isNaN(ffmpegCrf)) {
        throw new InvalidArgument('FFmpeg CRF is not a number');
      }
      if (ffmpegCrf < 0 || ffmpegCrf > 51) {
        throw new InvalidArgument('FFmpeg CRF must be between 0 and 51');
      }
      this.ffmpegCrf = ffmpegCrf;
    }
    if (values[this.ffmpegAudioBitrateFlag] !== undefined) {
      const ffmpegAudioBitrate = Number(values[this.ffmpegAudioBitrateFlag]);
      if (Number.isNaN(ffmpegAudioBitrate)) {
        throw new InvalidArgument('FFmpeg audio bitrate is not a number');
      }
      if (ffmpegAudioBitrate < 8) {
        throw new InvalidArgument('FFmpeg audio bitrate must be at least 8');
      }
      this.ffmpegAudioBitrate = ffmpegAudioBitrate;
    }
    if (values[this.ffmpegVideoCodecFlag] !== undefined) {
      this.ffmpegVideoCodec = values[this.ffmpegVideoCodecFlag];
    }
    if (values[this.ffmpegAudioCodecFlag]) {
      this.ffmpegAudioCodec = values[this.ffmpegAudioCodecFlag];
    }
    const videoContainer = values[this.ffmpegVideoContainerFlag];
    if (videoContainer !== undefined) {
      if (!isValidVideoContainer(videoContainer)) {
        throw new InvalidArgument('Invalid video container');
      }
      this.ffmpegVideoContainer = videoContainer;
    }
    if (values[this.ffmpegInputParametersFlag] !== undefined) {
      this.ffmpegInputParameters = values[this.ffmpegInputParametersFlag];
    }
    if (values[this.ffmpegOutputParametersFlag]) {
      this.ffmpegOutputParameters = values[this.ffmpegOutputParametersFlag];
    }
    const showXRay = values[this.showXRayFlag];
    if (showXRay !== undefined) {
      this.showXRay = true;
    }
    const noShowXRay = values[this.noShowXRayFlag];
    if (noShowXRay !== undefined) {
      this.showXRay = false;
    }
    const showAssists = values[this.showAssistsFlag];
    if (showAssists !== undefined) {
      this.showAssists = true;
    }
    const noShowAssists = values[this.noShowAssistsFlag];
    if (noShowAssists !== undefined) {
      this.showAssists = false;
    }
    const showOnlyDeathNotices = values[this.showOnlyDeathNoticesFlag];
    if (showOnlyDeathNotices !== undefined) {
      this.showOnlyDeathNotices = true;
    }
    const noShowOnlyDeathNotices = values[this.noShowOnlyDeathNoticesFlag];
    if (noShowOnlyDeathNotices !== undefined) {
      this.showOnlyDeathNotices = false;
    }
    const trueView = values[this.trueViewFlag];
    if (trueView !== undefined) {
      this.trueView = true;
    }
    const noTrueView = values[this.noTrueViewFlag];
    if (noTrueView !== undefined) {
      this.trueView = false;
    }
    const playerVoices = values[this.playerVoicesFlag];
    if (playerVoices !== undefined) {
      this.playerVoices = true;
    }
    const noPlayerVoices = values[this.noPlayerVoicesFlag];
    if (noPlayerVoices !== undefined) {
      this.playerVoices = false;
    }
    const recordAudio = values[this.recordAudioFlag];
    if (recordAudio !== undefined) {
      this.recordAudio = true;
    }
    const noRecordAudio = values[this.noRecordAudioFlag];
    if (noRecordAudio !== undefined) {
      this.recordAudio = false;
    }
    if (values[this.deathNoticesDurationFlag]) {
      const deathNoticesDuration = Number(values[this.deathNoticesDurationFlag]);
      if (Number.isNaN(deathNoticesDuration)) {
        throw new InvalidArgument('Death notices duration is not a number');
      }
      if (deathNoticesDuration < 0) {
        throw new InvalidArgument('Death notices duration must be at least 0');
      }
      this.deathNoticesDuration = deathNoticesDuration;
    }
    if (values[this.cfgFlag]) {
      this.cfg = values[this.cfgFlag];
    }
    if (values[this.focusPlayerFlag]) {
      this.focusPlayerSteamId = values[this.focusPlayerFlag] as string;
    }
  }
  // Options that can be used with or without a config file.
  private parseRecordingOptions(values: Record<string, string | boolean | undefined>) {
    if (values[this.jsonFlag] === true) {
      this.output = new CliOutput(true);
    }
    if (values[this.noAnalyzeFlag] === true) {
      this.analyze = false;
    }

    const preset = values[this.presetFlag];
    if (typeof preset === 'string') {
      if (preset !== 'auto' && !isValidFfmpegPresetId(preset)) {
        throw new InvalidArgument(
          `Invalid preset. Supported values: auto, ${ffmpegPresets.map((preset) => preset.id).join(', ')}`,
        );
      }
      this.preset = preset;
    }

    if (values[this.fastSeekFlag] === true) {
      this.fastSeek = true;
    }
    if (values[this.noFastSeekFlag] === true) {
      this.fastSeek = false;
    }

    const windowMode = values[this.windowModeFlag];
    if (typeof windowMode === 'string') {
      if (!isValidRecordingWindowMode(windowMode)) {
        throw new InvalidArgument(
          `Invalid window mode. Supported values: ${Object.values(RecordingWindowMode).join(', ')}`,
        );
      }
      this.windowMode = windowMode;
    }
  }

  private parsePositiveIntegerFlag(value: string | boolean | undefined, flag: string) {
    if (typeof value !== 'string') {
      return undefined;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
      throw new InvalidArgument(`--${flag} must be a positive integer`);
    }

    return number;
  }
}
