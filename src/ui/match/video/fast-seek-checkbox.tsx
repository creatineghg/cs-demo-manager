import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Checkbox } from 'csdm/ui/components/inputs/checkbox';
import { useVideoSettings } from 'csdm/ui/settings/video/use-video-settings';
import { Tooltip } from 'csdm/ui/components/tooltip';
import { QuestionIcon } from 'csdm/ui/icons/question-icon';

export function FastSeekCheckbox() {
  const { settings, updateSettings } = useVideoSettings();

  const onChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await updateSettings({
      fastSeek: event.target.checked,
    });
  };

  return (
    <div className="flex items-center gap-x-8">
      <Checkbox
        label={<Trans context="Checkbox label">Fast seek between sequences</Trans>}
        onChange={onChange}
        isChecked={settings.fastSeek}
      />
      <Tooltip
        content={
          <p>
            <Trans>
              Jump directly to the next sequence instead of restarting the demo from the beginning. Disable it if some
              sequences are not recorded.
            </Trans>
          </p>
        }
      >
        <QuestionIcon className="size-12" />
      </Tooltip>
    </div>
  );
}
