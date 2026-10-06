import type { FfmpegSettings } from 'csdm/node/settings/settings';
import { VideoContainer } from 'csdm/common/types/video-container';

export const FfmpegPresetId = {
  Default: 'default',
  Av1Nvenc: 'av1-nvenc',
  Av1Amf: 'av1-amf',
  Av1Qsv: 'av1-qsv',
  Av1Svt: 'av1-svt',
  HevcNvenc: 'hevc-nvenc',
  H264Nvenc: 'h264-nvenc',
  H264X264: 'h264-x264',
  ProResHq: 'prores-hq',
} as const;

export type FfmpegPresetId = (typeof FfmpegPresetId)[keyof typeof FfmpegPresetId];

export type FfmpegPresetSettings = Pick<
  FfmpegSettings,
  'videoCodec' | 'videoContainer' | 'audioCodec' | 'audioBitrate' | 'constantRateFactor' | 'outputParameters'
>;

export type FfmpegPreset = {
  id: FfmpegPresetId;
  // Codec and hardware names are not translated.
  name: string;
  // Hardware/software required to use the preset, also not translated.
  requirement: string;
  settings: FfmpegPresetSettings;
};

/**
 * Encoding presets tuned for high resolution / high framerate recordings (e.g. 4K 120 FPS).
 * 10-bit presets reduce color banding (smoke, skyboxes) which is noticeable on 8-bit AV1/HEVC encodes.
 * Parameters are passed as-is to FFmpeg, they must not contain double quotes or semicolons because they are also
 * embedded in HLAE console commands.
 */
export const ffmpegPresets: readonly FfmpegPreset[] = [
  {
    id: FfmpegPresetId.Default,
    name: 'H.264 (x264) - CS Demo Manager default',
    requirement: 'Any CPU',
    settings: {
      videoCodec: 'libx264',
      videoContainer: VideoContainer.AVI,
      audioCodec: 'libmp3lame',
      audioBitrate: 256,
      constantRateFactor: 23,
      outputParameters: '',
    },
  },
  {
    id: FfmpegPresetId.Av1Nvenc,
    name: 'AV1 10-bit (NVIDIA NVENC)',
    requirement: 'NVIDIA RTX 40 series or newer',
    settings: {
      videoCodec: 'av1_nvenc',
      videoContainer: VideoContainer.MP4,
      audioCodec: 'aac',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-preset p6 -tune hq -rc vbr -cq 24 -b:v 0 -spatial-aq 1 -temporal-aq 1 -pix_fmt p010le',
    },
  },
  {
    id: FfmpegPresetId.Av1Amf,
    name: 'AV1 10-bit (AMD AMF)',
    requirement: 'AMD Radeon RX 7000 series or newer',
    settings: {
      videoCodec: 'av1_amf',
      videoContainer: VideoContainer.MP4,
      audioCodec: 'aac',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-quality quality -rc cqp -qp_i 88 -qp_p 96 -pix_fmt p010le',
    },
  },
  {
    id: FfmpegPresetId.Av1Qsv,
    name: 'AV1 10-bit (Intel Quick Sync)',
    requirement: 'Intel Arc GPU or Intel Core Ultra iGPU',
    settings: {
      videoCodec: 'av1_qsv',
      videoContainer: VideoContainer.MP4,
      audioCodec: 'aac',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-preset slower -global_quality 24 -pix_fmt p010le',
    },
  },
  {
    id: FfmpegPresetId.Av1Svt,
    name: 'AV1 10-bit (SVT-AV1, CPU)',
    requirement: 'Any CPU (slow at 4K)',
    settings: {
      videoCodec: 'libsvtav1',
      videoContainer: VideoContainer.MP4,
      audioCodec: 'aac',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-preset 8 -crf 26 -svtav1-params tune=0 -pix_fmt yuv420p10le',
    },
  },
  {
    id: FfmpegPresetId.HevcNvenc,
    name: 'HEVC 10-bit (NVIDIA NVENC)',
    requirement: 'NVIDIA GTX 10 series or newer',
    settings: {
      videoCodec: 'hevc_nvenc',
      videoContainer: VideoContainer.MP4,
      audioCodec: 'aac',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-preset p6 -tune hq -rc vbr -cq 19 -b:v 0 -spatial-aq 1 -pix_fmt p010le -tag:v hvc1',
    },
  },
  {
    id: FfmpegPresetId.H264Nvenc,
    name: 'H.264 (NVIDIA NVENC)',
    requirement: 'NVIDIA GTX 10 series or newer',
    settings: {
      videoCodec: 'h264_nvenc',
      videoContainer: VideoContainer.MP4,
      audioCodec: 'aac',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-preset p6 -tune hq -rc vbr -cq 18 -b:v 0 -spatial-aq 1 -pix_fmt yuv420p',
    },
  },
  {
    id: FfmpegPresetId.H264X264,
    name: 'H.264 high quality (x264, CPU)',
    requirement: 'Any CPU',
    settings: {
      videoCodec: 'libx264',
      videoContainer: VideoContainer.MP4,
      audioCodec: 'aac',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-preset slow -crf 16 -pix_fmt yuv420p',
    },
  },
  {
    id: FfmpegPresetId.ProResHq,
    name: 'ProRes 422 HQ 10-bit (editing intermediate)',
    requirement: 'Any CPU (very large files)',
    settings: {
      videoCodec: 'prores_ks',
      videoContainer: VideoContainer.MOV,
      audioCodec: 'pcm_s16le',
      audioBitrate: 320,
      constantRateFactor: 23,
      outputParameters: '-profile:v 3 -vendor apl0 -pix_fmt yuv422p10le',
    },
  },
];

export function isValidFfmpegPresetId(value: string): value is FfmpegPresetId {
  return ffmpegPresets.some((preset) => preset.id === value);
}

export function getFfmpegPreset(id: FfmpegPresetId): FfmpegPreset {
  const preset = ffmpegPresets.find((preset) => preset.id === id);
  if (!preset) {
    throw new Error(`Unknown FFmpeg preset: ${id}`);
  }

  return preset;
}

// Returns the preset matching the given settings or undefined if the settings have been customized.
export function findFfmpegPresetFromSettings(settings: FfmpegPresetSettings): FfmpegPreset | undefined {
  return ffmpegPresets.find((preset) => {
    return (
      preset.settings.videoCodec === settings.videoCodec &&
      preset.settings.videoContainer === settings.videoContainer &&
      preset.settings.outputParameters === settings.outputParameters.trim() &&
      // The CRF is used only when there are no output parameters.
      (preset.settings.outputParameters !== '' || preset.settings.constantRateFactor === settings.constantRateFactor)
    );
  });
}

// True when the user already controls the pixel format, in this case we must not force one.
export function hasPixelFormatParameter(parameters: string) {
  return /(^|\s)-(pix_fmt|pixel_format)(:v)?\s/.test(`${parameters} `);
}
