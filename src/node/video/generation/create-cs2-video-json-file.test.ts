import { describe, expect, it } from 'vite-plus/test';
import type { Sequence } from 'csdm/common/types/sequence';
import { RecordingSystem } from 'csdm/common/types/recording-system';
import { RecordingOutput } from 'csdm/common/types/recording-output';
import { EncoderSoftware } from 'csdm/common/types/encoder-software';
import { VideoContainer } from 'csdm/common/types/video-container';
import { buildCs2VideoJsonActions, getSequenceTransition } from './create-cs2-video-json-file';

function buildSequence(number: number, startTick: number, endTick: number): Sequence {
  return {
    number,
    startTick,
    endTick,
    showXRay: false,
    showAssists: true,
    showOnlyDeathNotices: true,
    playersOptions: [],
    playerCameras: [{ tick: startTick, playerSteamId: '76561198000000001', playerName: 'player' }],
    cameras: [],
    playerVoicesEnabled: false,
    recordAudio: true,
    deathNoticesDuration: 5,
  };
}

function build(sequences: Sequence[], fastSeek: boolean, outputParameters = '') {
  return buildCs2VideoJsonActions({
    type: 'record',
    recordingSystem: RecordingSystem.HLAE,
    recordingOutput: RecordingOutput.Video,
    encoderSoftware: EncoderSoftware.FFmpeg,
    outputFolderPath: 'C:\\videos',
    framerate: 120,
    demoPath: 'C:\\demos\\demo.dem',
    sequences,
    closeGameAfterRecording: true,
    trueView: false,
    tickrate: 64,
    players: [{ steamId: '76561198000000001', slot: 2, userId: 1, side: 3 }],
    cameras: [],
    ffmpegSettings: {
      constantRateFactor: 23,
      videoCodec: 'av1_nvenc',
      videoContainer: VideoContainer.MP4,
      outputParameters,
    },
    fastSeek,
  }).build();
}

function findCommands(actions: { tick: number; cmd: string }[], prefix: string) {
  return actions.filter((action) => action.cmd.startsWith(prefix));
}

describe('getSequenceTransition', () => {
  const tickrate = 64;

  it('should restart the playback for the first sequence or when fast seek is disabled', () => {
    const sequence = buildSequence(1, 1000, 2000);
    expect(getSequenceTransition(undefined, sequence, tickrate, true)).toBe('restart');
    expect(getSequenceTransition(sequence, buildSequence(2, 10_000, 11_000), tickrate, false)).toBe('restart');
  });

  it('should restart the playback when sequences overlap', () => {
    const previous = buildSequence(1, 1000, 2000);
    expect(getSequenceTransition(previous, buildSequence(2, 1500, 2500), tickrate, true)).toBe('restart');
    // The setup tick of the next sequence (start - tickrate) is before the end margin of the previous one.
    expect(getSequenceTransition(previous, buildSequence(2, 2100, 3000), tickrate, true)).toBe('restart');
  });

  it('should keep playing when the next sequence starts shortly after the previous one', () => {
    const previous = buildSequence(1, 1000, 2000);
    expect(getSequenceTransition(previous, buildSequence(2, 2200, 3000), tickrate, true)).toBe('play');
  });

  it('should seek forward when the next sequence starts long after the previous one', () => {
    const previous = buildSequence(1, 1000, 2000);
    expect(getSequenceTransition(previous, buildSequence(2, 20_000, 21_000), tickrate, true)).toBe('seek');
  });
});

describe('buildCs2VideoJsonActions', () => {
  it('should restart the demo between each sequence when fast seek is disabled', () => {
    const sequences = build([buildSequence(1, 1000, 2000), buildSequence(2, 20_000, 21_000)], false);

    expect(sequences).toHaveLength(2);
    expect(findCommands(sequences[0].actions, 'go_to_next_sequence')).toEqual([
      { tick: 2064, cmd: 'go_to_next_sequence' },
    ]);
    expect(findCommands(sequences[1].actions, 'demo_gototick')).toEqual([{ tick: 96, cmd: 'demo_gototick 19935' }]);
  });

  it('should seek forward without restarting the demo when fast seek is enabled', () => {
    const sequences = build([buildSequence(1, 1000, 2000), buildSequence(2, 20_000, 21_000)], true);

    expect(sequences).toHaveLength(1);
    const [{ actions }] = sequences;
    expect(findCommands(actions, 'go_to_next_sequence')).toEqual([]);
    expect(findCommands(actions, 'demo_gototick')).toEqual([
      { tick: 96, cmd: 'demo_gototick 935' },
      { tick: 2064, cmd: 'demo_gototick 19935' },
    ]);
    // The first commands of the second sequence are executed at its setup tick, not at the beginning of the demo.
    expect(findCommands(actions, 'sv_cheats 1').map((action) => action.tick)).toEqual([96, 19_936]);
    expect(findCommands(actions, 'pause_playback').map((action) => action.tick)).toEqual([996, 19_996]);
    const recordStartTicks = actions
      .filter((action) => action.cmd === 'mirv_streams record start')
      .map(({ tick }) => tick);
    expect(recordStartTicks).toEqual([1000, 20_000]);
    expect(findCommands(actions, 'quit')).toEqual([{ tick: 21_064, cmd: 'quit' }]);
  });

  it('should keep playing between close sequences and skip the pause', () => {
    const sequences = build([buildSequence(1, 1000, 2000), buildSequence(2, 2200, 3000)], true);

    expect(sequences).toHaveLength(1);
    const [{ actions }] = sequences;
    expect(findCommands(actions, 'demo_gototick')).toEqual([{ tick: 96, cmd: 'demo_gototick 935' }]);
    expect(findCommands(actions, 'pause_playback').map((action) => action.tick)).toEqual([996]);
    expect(findCommands(actions, 'spec_player').map((action) => action.tick)).toEqual([1000, 2200]);
  });

  it('should restart the demo when sequences overlap even if fast seek is enabled', () => {
    const sequences = build(
      [buildSequence(1, 1000, 2000), buildSequence(2, 1500, 2500), buildSequence(3, 30_000, 31_000)],
      true,
    );

    expect(sequences).toHaveLength(2);
    expect(findCommands(sequences[0].actions, 'go_to_next_sequence')).toHaveLength(1);
    expect(findCommands(sequences[1].actions, 'demo_gototick')).toEqual([
      { tick: 96, cmd: 'demo_gototick 1435' },
      { tick: 2564, cmd: 'demo_gototick 29935' },
    ]);
  });

  it('should not force the pixel format when it is defined in the output parameters', () => {
    const [defaultSequence] = build([buildSequence(1, 1000, 2000)], true);
    const [customSequence] = build([buildSequence(1, 1000, 2000)], true, '-cq 24 -pix_fmt p010le');

    const [defaultPreset] = findCommands(defaultSequence.actions, 'mirv_streams settings add ffmpeg');
    const [customPreset] = findCommands(customSequence.actions, 'mirv_streams settings add ffmpeg');
    expect(defaultPreset.cmd).toContain('-c:v av1_nvenc -pix_fmt yuv420p -crf 23 ');
    expect(customPreset.cmd).toContain('-c:v av1_nvenc -cq 24 -pix_fmt p010le ');
    expect(customPreset.cmd).not.toContain('yuv420p');
  });
});
