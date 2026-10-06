import { describe, expect, it } from 'vite-plus/test';
import type { SequencePlayerOptions } from 'csdm/common/types/sequence-player-options';
import { anonymizePlayersOptions } from './anonymize-players-options';

function buildOptions(steamId: string, playerName: string): SequencePlayerOptions {
  return { steamId, playerName, showKill: true, highlightKill: false, isVoiceEnabled: true };
}

describe('anonymizePlayersOptions', () => {
  const options = [buildOptions('1', 'me'), buildOptions('2', 'bad name'), buildOptions('3', 'other')];

  const getName = (index: number) => `Player ${index}`;

  it('should replace all names', () => {
    expect(anonymizePlayersOptions(options, [], getName).map((option) => option.playerName)).toEqual([
      'Player 1',
      'Player 2',
      'Player 3',
    ]);
  });

  it('should keep the names of the given players', () => {
    expect(anonymizePlayersOptions(options, ['1'], getName).map((option) => option.playerName)).toEqual([
      'me',
      'Player 1',
      'Player 2',
    ]);
  });
});
