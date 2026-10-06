import type { Settings } from '../settings';
import type { Migration } from '../migration';
import { RecordingWindowMode } from 'csdm/common/types/recording-window-mode';

const v15: Migration = {
  schemaVersion: 15,
  run: (settings: Settings) => {
    settings.video.fastSeek = true;
    settings.video.windowMode = RecordingWindowMode.Background;

    return Promise.resolve(settings);
  },
};

export default v15;
