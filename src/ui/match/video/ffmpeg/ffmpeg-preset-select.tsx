import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { SelectOption } from 'csdm/ui/components/inputs/select';
import { Select } from 'csdm/ui/components/inputs/select';
import { useVideoSettings } from 'csdm/ui/settings/video/use-video-settings';
import {
  ffmpegPresets,
  findFfmpegPresetFromSettings,
  getFfmpegPreset,
  isValidFfmpegPresetId,
} from 'csdm/node/video/ffmpeg/ffmpeg-presets';

const customValue = 'custom';

export function FfmpegPresetSelect() {
  const { t } = useLingui();
  const { settings, updateSettings } = useVideoSettings();
  const currentPreset = findFfmpegPresetFromSettings(settings.ffmpegSettings);

  const options: SelectOption[] = ffmpegPresets.map((preset) => {
    return {
      value: preset.id,
      label: `${preset.name} - ${preset.requirement}`,
    };
  });
  options.push({
    value: customValue,
    label: t({
      context: 'Select option FFmpeg preset',
      message: 'Custom',
    }),
  });

  return (
    <div className="flex flex-col gap-y-8">
      <Select
        label={<Trans context="Select label">Encoding preset</Trans>}
        options={options}
        value={currentPreset?.id ?? customValue}
        onChange={async (value) => {
          if (!isValidFfmpegPresetId(value)) {
            return;
          }

          const preset = getFfmpegPreset(value);
          await updateSettings({
            ffmpegSettings: preset.settings,
          });
        }}
      />
      <p className="text-caption">
        <Trans>
          Presets fill the codec, container, quality and output parameters. Hardware presets require a compatible GPU.
        </Trans>
      </p>
    </div>
  );
}
