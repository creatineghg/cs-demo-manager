import type { SequencePlayerOptions } from 'csdm/common/types/sequence-player-options';

/**
 * Replaces players' name with a generic name in the kill feed/HUD, useful to share clips without exposing other players
 * (or offensive names). Players in keepSteamIds keep their name.
 * Requires HLAE, names are replaced with the "mirv_replace_name" command.
 */
export function anonymizePlayersOptions(
  options: SequencePlayerOptions[],
  keepSteamIds: string[],
  getName: (index: number) => string,
): SequencePlayerOptions[] {
  let index = 0;
  return options.map((playerOptions) => {
    if (keepSteamIds.includes(playerOptions.steamId)) {
      return playerOptions;
    }

    index++;
    return {
      ...playerOptions,
      playerName: getName(index),
    };
  });
}
