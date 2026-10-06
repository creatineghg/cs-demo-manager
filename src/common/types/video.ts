import type { FfmpegSettings } from 'csdm/node/settings/settings';
import type { Game } from './counter-strike';
import type { EncoderSoftware } from './encoder-software';
import type { Sequence } from './sequence';
import type { VideoStatus } from './video-status';
import type { ErrorCode } from '../error-code';
import type { RecordingOutput } from './recording-output';
import type { RecordingSystem } from './recording-system';
import type { RecordingWindowMode } from './recording-window-mode';

export type Video = {
  id: string;
  date: string;
  checksum: string;
  demoPath: string;
  mapName: string;
  game: Game;
  tickrate: number;
  recordingSystem: RecordingSystem;
  recordingOutput: RecordingOutput;
  encoderSoftware: EncoderSoftware;
  framerate: number;
  width: number;
  height: number;
  closeGameAfterRecording: boolean;
  concatenateSequences: boolean;
  outputFileName: string;
  ffmpegSettings: FfmpegSettings;
  outputFolderPath: string;
  sequences: Sequence[];
  output: string;
  status: VideoStatus;
  trueView: boolean;
  // CS2 only, optional because videos may be added by older CLI versions.
  fastSeek?: boolean;
  // @platform win32
  windowMode?: RecordingWindowMode;
  errorCode?: ErrorCode;
  currentSequence?: number;
  currentSequencePosition?: number;
};

export type AddVideoPayload = Omit<Video, 'id' | 'date' | 'status' | 'output'> & {
  id?: string;
  date?: string;
};

export type WatchVideoSequencesPayload = Omit<
  Video,
  'id' | 'date' | 'status' | 'output' | 'errorCode' | 'currentSequence' | 'currentSequencePosition'
>;
