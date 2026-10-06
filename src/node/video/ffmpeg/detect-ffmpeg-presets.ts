import { execFile } from 'node:child_process';
import { FfmpegPresetId, ffmpegPresets, getFfmpegPreset, type FfmpegPreset } from './ffmpeg-presets';

export type FfmpegPresetTestResult = {
  id: FfmpegPresetId;
  name: string;
  isWorking: boolean;
  error?: string;
};

// AV1 presets from the most to the least efficient, hardware encoders are much faster than the CPU one.
const av1PresetsByPriority: FfmpegPresetId[] = [
  FfmpegPresetId.Av1Nvenc,
  FfmpegPresetId.Av1Amf,
  FfmpegPresetId.Av1Qsv,
  FfmpegPresetId.Av1Svt,
];

/**
 * Encodes a few frames with the preset to know if it works on this computer.
 * Hardware encoders are compiled in FFmpeg builds even when the GPU doesn't support them, a real encode is the only
 * reliable way to know if they are usable. It also validates the preset's parameters.
 */
function testFfmpegPreset(ffmpegExecutablePath: string, preset: FfmpegPreset): Promise<FfmpegPresetTestResult> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=1280x720:r=30',
    '-frames:v',
    '5',
    '-c:v',
    preset.settings.videoCodec,
    ...preset.settings.outputParameters.split(/\s+/).filter((arg) => arg !== ''),
    '-f',
    'null',
    '-',
  ];

  return new Promise((resolve) => {
    execFile(ffmpegExecutablePath, args, { windowsHide: true, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({
        id: preset.id,
        name: preset.name,
        isWorking: error === null,
        error: error ? (stderr.trim().split('\n').at(-1) ?? error.message) : undefined,
      });
    });
  });
}

export async function testFfmpegPresets(ffmpegExecutablePath: string) {
  const results: FfmpegPresetTestResult[] = [];
  // Sequentially to not overload GPUs that have a limited number of encoding sessions.
  for (const preset of ffmpegPresets) {
    results.push(await testFfmpegPreset(ffmpegExecutablePath, preset));
  }

  return results;
}

// Returns the fastest AV1 preset that works on this computer.
export async function detectBestAv1Preset(ffmpegExecutablePath: string): Promise<FfmpegPreset | undefined> {
  for (const id of av1PresetsByPriority) {
    const preset = getFfmpegPreset(id);
    const result = await testFfmpegPreset(ffmpegExecutablePath, preset);
    if (result.isWorking) {
      return preset;
    }
    logger.debug(`FFmpeg preset ${id} not available: ${result.error}`);
  }

  return undefined;
}
