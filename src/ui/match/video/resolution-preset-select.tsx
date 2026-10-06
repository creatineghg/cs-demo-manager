import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { SelectOption } from 'csdm/ui/components/inputs/select';
import { Select } from 'csdm/ui/components/inputs/select';
import { useVideoSettings } from 'csdm/ui/settings/video/use-video-settings';
import { findVideoResolutionPreset, videoResolutionPresets } from 'csdm/common/video/video-resolution-presets';

const customValue = 'custom';

export function ResolutionPresetSelect() {
  const { t } = useLingui();
  const { settings, updateSettings } = useVideoSettings();
  const currentPreset = findVideoResolutionPreset(settings.width, settings.height);

  const options: SelectOption[] = videoResolutionPresets.map((preset) => {
    return {
      value: preset.id,
      label: `${preset.id} (${preset.width}x${preset.height})`,
    };
  });
  options.push({
    value: customValue,
    label: t({
      context: 'Select option resolution preset',
      message: 'Custom',
    }),
  });

  return (
    <Select
      label={<Trans context="Select label">Resolution</Trans>}
      options={options}
      value={currentPreset?.id ?? customValue}
      onChange={async (value) => {
        const preset = videoResolutionPresets.find((preset) => preset.id === value);
        if (!preset) {
          return;
        }

        await updateSettings({
          width: preset.width,
          height: preset.height,
        });
      }}
    />
  );
}
