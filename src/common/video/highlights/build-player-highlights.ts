import type { Kill } from 'csdm/common/types/kill';
import type { Match } from 'csdm/common/types/match';
import type { Clutch } from 'csdm/common/types/clutch';
import type { WeaponName } from 'csdm/common/types/counter-strike';
import type { Sequence } from 'csdm/common/types/sequence';
import type { VideoSettings } from 'csdm/node/settings/settings';

export type HighlightKill = {
  tick: number;
  victimSteamId: string;
  victimName: string;
  weaponName: WeaponName;
  isHeadshot: boolean;
  isWallbang: boolean;
  isNoScope: boolean;
  isThroughSmoke: boolean;
  isKillerAirborne: boolean;
  isKillerBlinded: boolean;
  distance: number;
};

export type PlayerHighlight = {
  roundNumber: number;
  playerSteamId: string;
  playerName: string;
  killCount: number;
  headshotCount: number;
  kills: HighlightKill[];
  // Defined when the player won a clutch situation (1vX) during the round.
  clutch: { opponentCount: number; won: boolean } | undefined;
  // Higher is better, it can be used to sort highlights and keep only the best ones.
  score: number;
  // Suggested ticks to record the highlight.
  startTick: number;
  endTick: number;
};

export type PlayerHighlightsOptions = {
  match: Pick<Match, 'kills' | 'clutches' | 'players' | 'tickrate' | 'tickCount'>;
  steamIds: string[];
  // Rounds with less kills are ignored, clutches are always included.
  minKillsInRound?: number;
  rounds?: number[];
  weapons?: WeaponName[];
  headshotsOnly?: boolean;
  startSecondsBeforeEvent?: number;
  endSecondsAfterEvent?: number;
};

function isTeamKill(kill: Kill) {
  return kill.killerSide === kill.victimSide;
}

// Kills of the given players that may be part of a highlight (no team kills, no kills while controlling a bot).
export function filterPlayerKills(
  kills: Kill[],
  {
    steamIds,
    rounds = [],
    weapons = [],
    headshotsOnly = false,
  }: Pick<PlayerHighlightsOptions, 'steamIds' | 'rounds' | 'weapons' | 'headshotsOnly'>,
) {
  return kills.filter((kill) => {
    if (!steamIds.includes(kill.killerSteamId) || isTeamKill(kill) || kill.isKillerControllingBot) {
      return false;
    }
    if (rounds.length > 0 && !rounds.includes(kill.roundNumber)) {
      return false;
    }
    if (weapons.length > 0 && !weapons.includes(kill.weaponName)) {
      return false;
    }
    if (headshotsOnly && !kill.isHeadshot) {
      return false;
    }

    return true;
  });
}

function computeKillScore(kill: Kill) {
  let score = 1;
  if (kill.isHeadshot) {
    score += 0.25;
  }
  if (kill.penetratedObjects > 0) {
    score += 0.5;
  }
  if (kill.isNoScope) {
    score += 1;
  }
  if (kill.isThroughSmoke) {
    score += 0.5;
  }
  if (kill.isKillerAirborne) {
    score += 0.75;
  }
  if (kill.isKillerBlinded) {
    score += 0.5;
  }

  return score;
}

function computeHighlightScore(kills: Kill[], clutch: Clutch | undefined, tickrate: number) {
  const killsScore = kills.reduce((total, kill) => total + computeKillScore(kill), 0);
  // Multi-kills are worth more than the sum of single kills.
  const multiKillBonus = kills.length >= 3 ? (kills.length - 2) * 2 : 0;
  // Kills done quickly one after the other are more impressive.
  let quickKillsBonus = 0;
  for (let index = 1; index < kills.length; index++) {
    if (kills[index].tick - kills[index - 1].tick <= tickrate * 2) {
      quickKillsBonus += 0.5;
    }
  }
  const clutchBonus = clutch?.won ? clutch.opponentCount * 1.5 : 0;

  return Math.round((killsScore + multiKillBonus + quickKillsBonus + clutchBonus) * 100) / 100;
}

/**
 * Returns one highlight per player and round, sorted by round number.
 * A highlight contains the player's kills of the round and the clutch information if any.
 */
export function buildPlayerHighlights({
  match,
  steamIds,
  minKillsInRound = 1,
  rounds = [],
  weapons = [],
  headshotsOnly = false,
  startSecondsBeforeEvent = 3,
  endSecondsAfterEvent = 2,
}: PlayerHighlightsOptions): PlayerHighlight[] {
  const kills = filterPlayerKills(match.kills, { steamIds, rounds, weapons, headshotsOnly });
  const killsPerPlayerRound = new Map<string, Kill[]>();
  for (const kill of kills) {
    const key = `${kill.killerSteamId}-${kill.roundNumber}`;
    const roundKills = killsPerPlayerRound.get(key) ?? [];
    roundKills.push(kill);
    killsPerPlayerRound.set(key, roundKills);
  }

  const ticksBefore = Math.round(match.tickrate * startSecondsBeforeEvent);
  const ticksAfter = Math.round(match.tickrate * endSecondsAfterEvent);
  const highlights: PlayerHighlight[] = [];
  for (const roundKills of killsPerPlayerRound.values()) {
    const [firstKill] = roundKills;
    const lastKill = roundKills.at(-1) ?? firstKill;
    const clutch = match.clutches.find((clutch) => {
      return clutch.roundNumber === firstKill.roundNumber && clutch.clutcherSteamId === firstKill.killerSteamId;
    });
    const isWonClutch = clutch?.won === true;
    if (roundKills.length < minKillsInRound && !isWonClutch) {
      continue;
    }

    const player = match.players.find((player) => player.steamId === firstKill.killerSteamId);
    highlights.push({
      roundNumber: firstKill.roundNumber,
      playerSteamId: firstKill.killerSteamId,
      playerName: player?.name ?? firstKill.killerName,
      killCount: roundKills.length,
      headshotCount: roundKills.filter((kill) => kill.isHeadshot).length,
      kills: roundKills.map((kill) => {
        return {
          tick: kill.tick,
          victimSteamId: kill.victimSteamId,
          victimName: kill.victimName,
          weaponName: kill.weaponName,
          isHeadshot: kill.isHeadshot,
          isWallbang: kill.penetratedObjects > 0,
          isNoScope: kill.isNoScope,
          isThroughSmoke: kill.isThroughSmoke,
          isKillerAirborne: kill.isKillerAirborne,
          isKillerBlinded: kill.isKillerBlinded,
          distance: kill.distance,
        };
      }),
      clutch: clutch ? { opponentCount: clutch.opponentCount, won: clutch.won } : undefined,
      score: computeHighlightScore(roundKills, clutch, match.tickrate),
      startTick: Math.max(1, firstKill.tick - ticksBefore),
      endTick: Math.min(match.tickCount, lastKill.tick + ticksAfter),
    });
  }

  return highlights.sort((highlightA, highlightB) => {
    return highlightA.roundNumber - highlightB.roundNumber || highlightA.startTick - highlightB.startTick;
  });
}

// Keeps the N best highlights by score, the result is still sorted by round number.
export function keepBestHighlights(highlights: PlayerHighlight[], count: number) {
  if (count <= 0 || highlights.length <= count) {
    return highlights;
  }

  const bestHighlights = new Set(
    highlights.toSorted((highlightA, highlightB) => highlightB.score - highlightA.score).slice(0, count),
  );

  return highlights.filter((highlight) => bestHighlights.has(highlight));
}

type SequencesSettings = Pick<
  VideoSettings,
  'showOnlyDeathNotices' | 'deathNoticesDuration' | 'showXRay' | 'showAssists' | 'recordAudio' | 'playerVoicesEnabled'
>;

// Creates one video sequence per highlight, the camera follows the highlight's player and their kills are highlighted
// in the kill feed.
export function buildHighlightsSequences({
  highlights,
  match,
  settings,
  firstSequenceNumber = 1,
}: {
  highlights: PlayerHighlight[];
  match: Pick<Match, 'players'>;
  settings: SequencesSettings;
  firstSequenceNumber?: number;
}): Sequence[] {
  const highlightedSteamIds = new Set(highlights.map((highlight) => highlight.playerSteamId));
  const playersOptions = match.players.map((player) => {
    return {
      playerName: player.name,
      steamId: player.steamId,
      showKill: true,
      highlightKill: highlightedSteamIds.has(player.steamId),
      isVoiceEnabled: true,
    };
  });

  return highlights.map((highlight, index) => {
    return {
      number: firstSequenceNumber + index,
      startTick: highlight.startTick,
      endTick: highlight.endTick,
      showOnlyDeathNotices: settings.showOnlyDeathNotices,
      deathNoticesDuration: settings.deathNoticesDuration,
      showXRay: settings.showXRay,
      showAssists: settings.showAssists,
      recordAudio: settings.recordAudio,
      playerVoicesEnabled: settings.playerVoicesEnabled,
      playersOptions,
      playerCameras: [
        {
          tick: highlight.startTick,
          playerSteamId: highlight.playerSteamId,
          playerName: highlight.playerName,
        },
      ],
      cameras: [],
    };
  });
}
