export type VideoResolutionPreset = {
  id: string;
  width: number;
  height: number;
};

export const videoResolutionPresets: readonly VideoResolutionPreset[] = [
  { id: '720p', width: 1280, height: 720 },
  { id: '1080p', width: 1920, height: 1080 },
  { id: '1440p', width: 2560, height: 1440 },
  { id: '4k', width: 3840, height: 2160 },
];

export function findVideoResolutionPreset(width: number, height: number) {
  return videoResolutionPresets.find((preset) => preset.width === width && preset.height === height);
}

// Accepts a preset id (case insensitive, "2160p" is an alias of "4k") or a "<width>x<height>" value.
export function parseVideoResolution(value: string): { width: number; height: number } | undefined {
  const normalizedValue = value.trim().toLowerCase();
  const presetId = normalizedValue === '2160p' || normalizedValue === 'uhd' ? '4k' : normalizedValue;
  const preset = videoResolutionPresets.find((preset) => preset.id === presetId);
  if (preset) {
    return { width: preset.width, height: preset.height };
  }

  const match = /^(\d+)x(\d+)$/.exec(normalizedValue);
  if (!match) {
    return undefined;
  }

  return { width: Number(match[1]), height: Number(match[2]) };
}
