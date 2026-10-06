import { describe, expect, it } from 'vite-plus/test';
import {
  FfmpegPresetId,
  ffmpegPresets,
  findFfmpegPresetFromSettings,
  getFfmpegPreset,
  hasPixelFormatParameter,
  isValidFfmpegPresetId,
} from './ffmpeg-presets';
import { defaultSettings } from 'csdm/node/settings/default-settings';

describe('ffmpegPresets', () => {
  it('should have unique ids', () => {
    const ids = ffmpegPresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should not contain characters that would break HLAE console commands', () => {
    for (const preset of ffmpegPresets) {
      expect(preset.settings.outputParameters).not.toMatch(/["';]/);
    }
  });

  it('should match the default settings with the default preset', () => {
    expect(findFfmpegPresetFromSettings(defaultSettings.video.ffmpegSettings)?.id).toBe(FfmpegPresetId.Default);
  });

  it('should find the preset from settings', () => {
    const preset = getFfmpegPreset(FfmpegPresetId.Av1Nvenc);
    expect(findFfmpegPresetFromSettings({ ...preset.settings, audioBitrate: 128 })?.id).toBe(FfmpegPresetId.Av1Nvenc);
    expect(findFfmpegPresetFromSettings({ ...preset.settings, outputParameters: '-cq 30' })).toBeUndefined();
  });

  it('should validate preset ids', () => {
    expect(isValidFfmpegPresetId('av1-nvenc')).toBe(true);
    expect(isValidFfmpegPresetId('av1')).toBe(false);
  });
});

describe('hasPixelFormatParameter', () => {
  it('should detect the pixel format parameter', () => {
    expect(hasPixelFormatParameter('-pix_fmt p010le')).toBe(true);
    expect(hasPixelFormatParameter('-cq 24 -pix_fmt:v yuv420p10le -b:v 0')).toBe(true);
    expect(hasPixelFormatParameter('-cq 24')).toBe(false);
    expect(hasPixelFormatParameter('')).toBe(false);
  });
});
