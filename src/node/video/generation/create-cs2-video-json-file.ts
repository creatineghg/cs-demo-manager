import type { Sequence } from 'csdm/common/types/sequence';
import { getSequenceName } from 'csdm/node/video/generation/get-sequence-name';
import { JSONActionsFileGenerator } from 'csdm/node/counter-strike/json-actions-file/json-actions-file-generator';
import { Game } from 'csdm/common/types/counter-strike';
import { generatePlayerVoicesValues } from 'csdm/node/counter-strike/launcher/generate-player-voices-values';
import type { PlayerWatchInfo } from 'csdm/common/types/player-watch-info';
import { windowsToUnixPathSeparator } from 'csdm/node/filesystem/windows-to-unix-path-separator';
import { RecordingOutput } from 'csdm/common/types/recording-output';
import { RecordingSystem } from 'csdm/common/types/recording-system';
import { EncoderSoftware } from 'csdm/common/types/encoder-software';
import type { VideoContainer } from 'csdm/common/types/video-container';
import type { Camera } from 'csdm/common/types/camera';
import { hasPixelFormatParameter } from 'csdm/node/video/ffmpeg/ffmpeg-presets';
import { buildSequenceStartCommand } from './watch-recording-progress';

function getHlaeOutputFolderPath(outputFolderPath: string, sequence: Sequence) {
  return `${windowsToUnixPathSeparator(outputFolderPath)}/${getSequenceName(sequence)}`;
}

// How many ticks the playback continues after the end of a sequence before going to the next one.
// It gives time to the game/HLAE to finish writing the sequence's files.
const SEQUENCE_END_MARGIN_TICKS = 64;

// When the next sequence starts less than this number of seconds after the end of the previous one (margin included),
// the demo keeps playing instead of seeking because a seek (+ the pause to hide the seek tint effect) takes longer.
const MAX_SECONDS_TO_PLAY_INSTEAD_OF_SEEKING = 3;

function getSetupSequenceTick(sequence: Sequence, tickrate: number) {
  return Math.max(1, sequence.startTick - Math.round(tickrate));
}

/**
 * How to reach a sequence from the previous one:
 * - restart: go back to the beginning of the demo and seek to the sequence (default behavior, works in every case).
 * - seek: seek forward to the sequence without going back to the beginning of the demo.
 * - play: the sequence starts right after the previous one, the demo keeps playing until the sequence starts.
 */
type Transition = 'restart' | 'seek' | 'play';

export function getSequenceTransition(
  previous: Sequence | undefined,
  next: Sequence,
  tickrate: number,
  fastSeek: boolean,
): Transition {
  if (!previous || !fastSeek) {
    return 'restart';
  }

  const previousEndTick = previous.endTick + SEQUENCE_END_MARGIN_TICKS;
  const nextSetupTick = getSetupSequenceTick(next, tickrate);
  // We must be sure that the setup commands of the next sequence are executed after the end of the previous one,
  // it's not the case when sequences overlap, the only way is to restart the playback.
  if (nextSetupTick - 1 <= previousEndTick) {
    return 'restart';
  }

  const ticksBetweenSequences = nextSetupTick - previousEndTick;
  if (ticksBetweenSequences <= Math.round(tickrate) * MAX_SECONDS_TO_PLAY_INSTEAD_OF_SEEKING) {
    return 'play';
  }

  return 'seek';
}

type Options = {
  type: 'record' | 'watch';
  recordingSystem: RecordingSystem;
  recordingOutput: RecordingOutput;
  encoderSoftware: EncoderSoftware;
  outputFolderPath: string;
  framerate: number;
  demoPath: string;
  sequences: Sequence[];
  closeGameAfterRecording: boolean;
  trueView: boolean;
  tickrate: number;
  players: PlayerWatchInfo[];
  cameras: Camera[];
  ffmpegSettings: {
    constantRateFactor: number;
    videoContainer: VideoContainer;
    videoCodec: string;
    outputParameters: string;
  };
  // CS2 only. When enabled, the playback doesn't restart from the beginning of the demo between sequences if possible.
  fastSeek?: boolean;
};

export function buildCs2VideoJsonActions({
  type,
  recordingSystem,
  recordingOutput,
  encoderSoftware,
  outputFolderPath,
  framerate,
  demoPath,
  sequences,
  closeGameAfterRecording,
  trueView,
  tickrate,
  players,
  cameras,
  ffmpegSettings,
  fastSeek = false,
}: Options) {
  const json = new JSONActionsFileGenerator(demoPath, Game.CS2);

  const mandatoryCommands = [
    'sv_cheats 1',
    'volume 1',
    'cl_hud_telemetry_frametime_show 0',
    'cl_hud_telemetry_net_misdelivery_show 0',
    'cl_hud_telemetry_ping_show 0',
    'cl_hud_telemetry_serverrecvmargin_graph_show 0',
    'cl_trueview_show_status 0',
    'r_show_build_info 0',
    'mirv_streams record screen enabled 1',
    `cl_demo_predict ${trueView ? 1 : 0}`,
    // Keep the game running at full speed and keep its audio when the window loses the focus, users can do something
    // else during the recording. Values are saved in the CS:DM config folder, not the user's config.
    'engine_no_focus_sleep 0',
    'snd_mute_losefocus 0',
  ];

  for (let i = 0; i < sequences.length; i++) {
    const sequence = sequences[i];
    const roundedTickrate = Math.round(tickrate);
    const setupSequenceTick = getSetupSequenceTick(sequence, tickrate);
    const transition = getSequenceTransition(sequences[i - 1], sequence, tickrate, fastSeek);
    // When the playback restarts, the first commands are executed at the beginning of the demo, otherwise the demo
    // is already at the right position and they are executed with the other setup commands.
    const firstCommandsTick = transition === 'restart' ? 1 : setupSequenceTick;

    for (const command of mandatoryCommands) {
      json.addExecCommand(firstCommandsTick, command);
    }

    json.addExecCommand(firstCommandsTick, `cl_draw_only_deathnotices ${sequence.showOnlyDeathNotices ? 1 : 0}`);
    json.addExecCommand(firstCommandsTick, `mirv_deathmsg lifetime ${sequence.deathNoticesDuration}`);
    json.addExecCommand(firstCommandsTick, `mirv_deathmsg filter clear`);

    if (sequence.playerVoicesEnabled) {
      json.enablePlayerVoices(firstCommandsTick);
    } else {
      json.disablePlayerVoices(firstCommandsTick);
    }

    const hlaeOutputFolderPath = getHlaeOutputFolderPath(outputFolderPath, sequence);
    const presetName =
      recordingOutput === RecordingOutput.Video && encoderSoftware === EncoderSoftware.FFmpeg
        ? `csdmPreset${sequence.number}`
        : 'afxClassic';

    json
      .addExecCommand(setupSequenceTick, `mirv_streams record startMovieWav ${sequence.recordAudio ? 1 : 0}`)
      .addExecCommand(setupSequenceTick, `mirv_streams record name "${hlaeOutputFolderPath}"`)
      .addExecCommand(setupSequenceTick, `mirv_deathmsg clear`)
      .addExecCommand(setupSequenceTick, `spec_show_xray ${sequence.showXRay ? 1 : 0}`)
      .addExecCommand(setupSequenceTick, `mp_display_kill_assists ${sequence.showAssists ? 1 : 0}`);

    if (presetName !== 'afxClassic') {
      let presetParameters = `-c:v ${ffmpegSettings.videoCodec}`;
      // Let users choose the pixel format, e.g. a 10-bit one for AV1/HEVC.
      if (!hasPixelFormatParameter(ffmpegSettings.outputParameters)) {
        presetParameters += ' -pix_fmt yuv420p';
      }
      if (ffmpegSettings.outputParameters === '') {
        presetParameters += ` -crf ${ffmpegSettings.constantRateFactor}`;
      } else {
        presetParameters += ` ${ffmpegSettings.outputParameters}`;
      }
      json
        .addExecCommand(
          setupSequenceTick,
          `mirv_streams settings add ffmpeg ${presetName} "${presetParameters} {QUOTE}${hlaeOutputFolderPath}\\\\video.${ffmpegSettings.videoContainer}{QUOTE}"`,
        )
        .addExecCommand(setupSequenceTick, `mirv_streams record screen settings ${presetName}`);
    }

    if (recordingSystem === RecordingSystem.HLAE) {
      json.addExecCommand(setupSequenceTick, `mirv_streams record fps ${framerate}`);
    } else {
      json.addExecCommand(setupSequenceTick, `host_framerate ${framerate}`);
    }

    if (typeof sequence.cfg === 'string') {
      const commands = sequence.cfg.split('\n');
      for (const command of commands) {
        json.addExecCommand(setupSequenceTick, command);
      }
    }

    // Pause the playback for a few seconds to avoid seeing the loading screen/tint effect.
    // Do it a few ticks before the sequence's start tick because some ticks may be skipped between the time that the
    // plugin pauses the playback and the time that the game actually pauses the playback (it would result in
    // startmovie commands not being executed and so missing sequences).
    // Not needed when the demo kept playing since the previous sequence, there is no seek effect to hide.
    if (transition !== 'play') {
      json.addPausePlayback(Math.max(1, sequence.startTick - 4));
    }

    // Go to 1 tick before the sequence's setup tick to make sure the setup commands are executed.
    // It may not if we do both the skip ahead and the setup cmds at the same tick.
    // Since an October 2025 CS2 update, executing spec_player and demo_gototick on the same tick may cause
    // spec_player to be ignored. It's important to go to the setup tick before executing any spec_player command.
    // https://github.com/akiver/cs-demo-manager/issues/1238
    // When the transition is a seek or play, the previous sequence already moved the playback to this position.
    if (transition === 'restart') {
      json.addGoToTick(1, Math.max(1, setupSequenceTick - 1));
    }

    // Camera commands must not be executed before the setup tick when chaining sequences, they would be executed
    // while the previous sequence is still being recorded.
    const minCameraTick = transition === 'restart' ? 1 : setupSequenceTick;
    for (const camera of sequence.playerCameras) {
      const player = players.find((player) => player.steamId === camera.playerSteamId);
      if (player) {
        json.addSpecPlayer(Math.max(minCameraTick, camera.tick), player.slot);
      }
    }
    for (const { id, tick } of sequence.cameras) {
      const camera = cameras.find((camera) => id === camera.id);
      if (camera) {
        json.addFocusCamera(Math.max(minCameraTick, tick), camera);
      }
    }

    json.addExecCommand(setupSequenceTick, `mirv_deathmsg filter clear`);
    if (sequence.playersOptions.length > 0) {
      // Block all death notices by default and then selectively allow them based on player's options.
      json.addExecCommand(setupSequenceTick, `mirv_deathmsg filter add block=1`);
    }

    for (const playerOptions of sequence.playersOptions) {
      // Unlike CS:GO, support for double quotes in player's name is not supported in CS2.
      // The reason is that the "mirv_exec" command used as a workaround in CS:GO is not available for CS2.
      const replacePlayerNameCommand = `mirv_replace_name byXuid add x${playerOptions.steamId} "${playerOptions.playerName}"`;
      json.addExecCommand(setupSequenceTick, replacePlayerNameCommand);

      if (playerOptions.showKill) {
        json.addExecCommand(
          setupSequenceTick,
          `mirv_deathmsg filter add attackerMatch=x${playerOptions.steamId} attackerIsLocal=${playerOptions.highlightKill ? '1' : '0'} block=0`,
        );
      }

      if (playerOptions.isVoiceEnabled) {
        const playersWithVoiceEnabled = sequence.playersOptions.filter((playerOptions) => playerOptions.isVoiceEnabled);
        if (playersWithVoiceEnabled.length !== sequence.playersOptions.length) {
          const userIds: number[] = [];
          for (const playerOptions of playersWithVoiceEnabled) {
            const player = players.find((player) => player.steamId === playerOptions.steamId);
            if (player) {
              userIds.push(player.userId);
            }
          }
          const { valueLow, valueHigh } = generatePlayerVoicesValues(userIds);
          json.addExecCommand(setupSequenceTick, `tv_listen_voice_indices ${valueLow}`);
          json.addExecCommand(setupSequenceTick, `tv_listen_voice_indices_h ${valueHigh}`);
        }
      }
    }

    if (type === 'record') {
      // Lets CS:DM know which sequence is being recorded by reading the plugin log file.
      json.addExecCommand(sequence.startTick, buildSequenceStartCommand(sequence.number));
      if (recordingSystem === RecordingSystem.HLAE) {
        json
          .addExecCommand(sequence.startTick, `mirv_streams record start`)
          .addExecCommand(sequence.endTick, 'mirv_streams record end');
      } else {
        json
          .addExecCommand(sequence.startTick, `startmovie ${getSequenceName(sequence)}`)
          .addExecCommand(sequence.endTick, 'endmovie');
      }
    }

    const nextSequence = sequences.at(i + 1);
    const nextTransition = nextSequence ? getSequenceTransition(sequence, nextSequence, tickrate, fastSeek) : undefined;
    const sequenceEndTick = sequence.endTick + SEQUENCE_END_MARGIN_TICKS;

    if (nextSequence === undefined && closeGameAfterRecording) {
      json.addExecCommand(sequenceEndTick, 'quit');
    } else if (nextSequence !== undefined && nextTransition === 'seek') {
      json.addGoToTick(sequenceEndTick, getSetupSequenceTick(nextSequence, roundedTickrate) - 1);
    } else if (nextTransition !== 'play') {
      json.addGoToNextSequence(sequenceEndTick);
    }
  }

  return json;
}

export async function createCs2VideoJsonFile(options: Options) {
  const json = buildCs2VideoJsonActions(options);
  await json.write();
}
