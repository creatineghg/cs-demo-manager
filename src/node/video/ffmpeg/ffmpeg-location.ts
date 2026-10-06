import path from 'node:path';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { isWindows } from 'csdm/node/os/is-windows';
import { getSettings } from 'csdm/node/settings/get-settings';
import { isMac } from 'csdm/node/os/is-mac';
import type { FfmpegSettings } from 'csdm/node/settings/settings';

export function getDefaultFfmpegInstallationPath() {
  return path.join(getAppFolderPath(), 'ffmpeg');
}

export function getDefaultFfmpegExecutablePath() {
  const ffmpegFolderPath = getDefaultFfmpegInstallationPath();

  if (isMac) {
    return path.join(ffmpegFolderPath, 'ffmpeg');
  }

  return path.join(ffmpegFolderPath, 'bin', isWindows ? 'ffmpeg.exe' : 'ffmpeg');
}

type FfmpegLocationSettings = Pick<FfmpegSettings, 'customLocationEnabled' | 'customExecutableLocation'>;

// Returns the FFmpeg executable to use for the given FFmpeg settings, e.g. the ones of a video in the queue that may
// differ from the app settings when the video has been added from the CLI.
export function getFfmpegExecutablePathFromSettings(ffmpegSettings: FfmpegLocationSettings) {
  if (ffmpegSettings.customLocationEnabled && ffmpegSettings.customExecutableLocation.trim() !== '') {
    return ffmpegSettings.customExecutableLocation;
  }

  return getDefaultFfmpegExecutablePath();
}

export async function getFfmpegExecutablePath() {
  const { video } = await getSettings();

  return getFfmpegExecutablePathFromSettings(video.ffmpegSettings);
}
