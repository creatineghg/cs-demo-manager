import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { SettingsEntry } from 'csdm/ui/settings/settings-entry';
import { TextInput } from 'csdm/ui/components/inputs/text-input';
import { usePlaybackSettings } from './use-playback-settings';

export function LinuxLaunchCommandPrefix() {
  const { linuxLaunchCommandPrefix, updateSettings } = usePlaybackSettings();
  const { t } = useLingui();

  const onBlur = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newPrefix = event.target.value.trim();
    if (newPrefix !== (linuxLaunchCommandPrefix ?? '')) {
      await updateSettings({
        linuxLaunchCommandPrefix: newPrefix,
      });
    }
  };

  return (
    <SettingsEntry
      interactiveComponent={
        <TextInput
          onBlur={onBlur}
          defaultValue={linuxLaunchCommandPrefix ?? ''}
          placeholder={t({
            context: 'Input placeholder',
            message: 'Command prefix',
          })}
        />
      }
      description={
        <Trans>
          Command added before the game command, e.g. <code>gamescope --backend headless -W 3840 -H 2160 --</code> to
          record videos without a visible game window.
        </Trans>
      }
      title={<Trans context="Settings title">Launch command prefix</Trans>}
    />
  );
}
