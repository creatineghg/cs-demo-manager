import React, { useState } from 'react';
import { TextInput } from 'csdm/ui/components/inputs/text-input';
import type { SequencePlayerOptions } from 'csdm/common/types/sequence-player-options';
import type { CellProps } from 'csdm/ui/components/table/table-types';
import { usePlayersOptions } from './use-players-options';

type Props = CellProps<SequencePlayerOptions>;

export function PlayerNameInput({ rowIndex }: Props) {
  const { options, update } = usePlayersOptions();
  const optionsPlayerName = options[rowIndex].playerName;
  const [playerName, setPlayerName] = useState(optionsPlayerName);
  // Sync the input when names are updated from outside of this input (e.g. hide player names button).
  const [previousOptionsPlayerName, setPreviousOptionsPlayerName] = useState(optionsPlayerName);
  if (optionsPlayerName !== previousOptionsPlayerName) {
    setPreviousOptionsPlayerName(optionsPlayerName);
    setPlayerName(optionsPlayerName);
  }
  // Player's name edition is available only on Windows
  const isDisabled = !window.csdm.isWindows;

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setPlayerName(value);
  };

  const onBlur = () => {
    update(
      options.map((options, index) => {
        if (index === rowIndex) {
          return {
            ...options,
            playerName,
          };
        }
        return options;
      }),
    );
  };

  return <TextInput onChange={onChange} onBlur={onBlur} value={playerName} isDisabled={isDisabled} />;
}
