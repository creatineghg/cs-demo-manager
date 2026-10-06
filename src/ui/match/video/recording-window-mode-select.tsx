import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { SelectOption } from 'csdm/ui/components/inputs/select';
import { Select } from 'csdm/ui/components/inputs/select';
import { useVideoSettings } from 'csdm/ui/settings/video/use-video-settings';
import { RecordingWindowMode } from 'csdm/common/types/recording-window-mode';

export function RecordingWindowModeSelect() {
  const { t } = useLingui();
  const { settings, updateSettings } = useVideoSettings();

  const options: SelectOption<RecordingWindowMode>[] = [
    {
      value: RecordingWindowMode.Normal,
      label: t({
        context: 'Select option game window mode',
        message: 'Normal',
      }),
    },
    {
      value: RecordingWindowMode.Background,
      label: t({
        context: 'Select option game window mode',
        message: 'Background',
      }),
    },
    {
      value: RecordingWindowMode.OffScreen,
      label: t({
        context: 'Select option game window mode',
        message: 'Off-screen',
      }),
    },
  ];

  return (
    <div className="mb-8 flex w-[152px] flex-col gap-y-8">
      <Select
        label={<Trans context="Select label">Game window</Trans>}
        options={options}
        value={settings.windowMode}
        onChange={async (windowMode) => {
          await updateSettings({
            windowMode,
          });
        }}
      />
    </div>
  );
}
