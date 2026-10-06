import { describe, expect, it } from 'vite-plus/test';
import type { Kill } from 'csdm/common/types/kill';
import type { Clutch } from 'csdm/common/types/clutch';
import type { MatchPlayer } from 'csdm/common/types/match-player';
import { TeamNumber, WeaponName } from 'csdm/common/types/counter-strike';
import { buildHighlightsSequences, buildPlayerHighlights, keepBestHighlights } from './build-player-highlights';

const player = '76561198000000001';
const teammate = '76561198000000002';
const enemy = '76561198000000003';

function buildKill(roundNumber: number, tick: number, overrides: Partial<Kill> = {}): Kill {
  return {
    id: tick,
    matchChecksum: 'checksum',
    tick,
    frame: tick,
    roundNumber,
    killerSteamId: player,
    killerName: 'player',
    killerSide: TeamNumber.CT,
    victimSteamId: enemy,
    victimName: 'enemy',
    victimSide: TeamNumber.T,
    isHeadshot: false,
    penetratedObjects: 0,
    isNoScope: false,
    isThroughSmoke: false,
    isKillerAirborne: false,
    isKillerBlinded: false,
    isKillerControllingBot: false,
    distance: 10,
    weaponName: WeaponName.AK47,
    ...overrides,
  } as Kill;
}

const players = [
  { steamId: player, name: 'player' },
  { steamId: teammate, name: 'teammate' },
  { steamId: enemy, name: 'enemy' },
] as MatchPlayer[];

describe('buildPlayerHighlights', () => {
  const kills = [
    buildKill(1, 1000),
    buildKill(2, 5000, { isHeadshot: true }),
    buildKill(2, 5100),
    buildKill(2, 5200, { weaponName: WeaponName.AWP, isNoScope: true }),
    // Team kill and kill of another player, must be ignored.
    buildKill(2, 5300, { victimSide: TeamNumber.CT, victimSteamId: teammate }),
    buildKill(3, 9000, { killerSteamId: teammate }),
    buildKill(4, 12_000),
  ];
  const clutches = [{ roundNumber: 4, clutcherSteamId: player, opponentCount: 2, won: true }] as Clutch[];
  const match = { kills, clutches, players, tickrate: 64, tickCount: 100_000 };

  it('should group the kills per round', () => {
    const highlights = buildPlayerHighlights({ match, steamIds: [player] });

    expect(highlights.map((highlight) => [highlight.roundNumber, highlight.killCount])).toEqual([
      [1, 1],
      [2, 3],
      [4, 1],
    ]);
    const [, multiKill, clutch] = highlights;
    expect(multiKill.headshotCount).toBe(1);
    expect(multiKill.startTick).toBe(5000 - 3 * 64);
    expect(multiKill.endTick).toBe(5200 + 2 * 64);
    expect(clutch.clutch).toEqual({ opponentCount: 2, won: true });
    expect(multiKill.score).toBeGreaterThan(highlights[0].score);
  });

  it('should keep rounds with enough kills and won clutches', () => {
    const highlights = buildPlayerHighlights({ match, steamIds: [player], minKillsInRound: 3 });

    expect(highlights.map((highlight) => highlight.roundNumber)).toEqual([2, 4]);
  });

  it('should filter by weapon and headshots', () => {
    expect(buildPlayerHighlights({ match, steamIds: [player], weapons: [WeaponName.AWP] })).toHaveLength(1);
    expect(buildPlayerHighlights({ match, steamIds: [player], headshotsOnly: true })[0].roundNumber).toBe(2);
  });

  it('should keep the best highlights sorted by round', () => {
    const highlights = buildPlayerHighlights({ match, steamIds: [player] });

    expect(keepBestHighlights(highlights, 2).map((highlight) => highlight.roundNumber)).toEqual([2, 4]);
  });

  it('should build one sequence per highlight', () => {
    const highlights = buildPlayerHighlights({ match, steamIds: [player], minKillsInRound: 3 });
    const sequences = buildHighlightsSequences({
      highlights,
      match,
      settings: {
        showOnlyDeathNotices: true,
        deathNoticesDuration: 5,
        showXRay: false,
        showAssists: true,
        recordAudio: true,
        playerVoicesEnabled: false,
      },
    });

    expect(sequences.map((sequence) => sequence.number)).toEqual([1, 2]);
    expect(sequences[0].playerCameras).toEqual([{ tick: 4808, playerSteamId: player, playerName: 'player' }]);
    expect(sequences[0].playersOptions.find((options) => options.steamId === player)?.highlightKill).toBe(true);
    expect(sequences[0].playersOptions.find((options) => options.steamId === enemy)?.highlightKill).toBe(false);
  });
});
