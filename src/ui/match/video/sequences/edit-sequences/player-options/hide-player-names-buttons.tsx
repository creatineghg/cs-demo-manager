import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Button } from 'csdm/ui/components/buttons/button';
import { useCurrentMatch } from 'csdm/ui/match/use-current-match';
import { anonymizePlayersOptions } from 'csdm/common/video/sequences/anonymize-players-options';
import { usePlayersOptions } from './use-players-options';

// Player's name edition requires HLAE, available only on Windows.
export function HidePlayerNamesButtons() {
  const { t } = useLingui();
  const match = useCurrentMatch();
  const { options, update } = usePlayersOptions();

  if (!window.csdm.isWindows) {
    return null;
  }

  const hideNames = () => {
    update(
      anonymizePlayersOptions(options, [], (index) => {
        return t({
          context: 'Anonymized player name in videos',
          message: `Player ${index}`,
        });
      }),
    );
  };

  const restoreNames = () => {
    update(
      options.map((playerOptions) => {
        const player = match.players.find((player) => player.steamId === playerOptions.steamId);
        return player ? { ...playerOptions, playerName: player.name } : playerOptions;
      }),
    );
  };

  return (
    <div className="flex gap-x-8">
      <Button onClick={hideNames}>
        <Trans context="Button">Hide player names</Trans>
      </Button>
      <Button onClick={restoreNames}>
        <Trans context="Button">Restore player names</Trans>
      </Button>
    </div>
  );
}
