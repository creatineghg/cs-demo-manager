import type { DemoSource, Game } from 'csdm/common/types/counter-strike';
import { TeamLetter } from 'csdm/common/types/counter-strike';
import { db } from 'csdm/node/database/database';

type MatchSummaryPlayer = {
  steamId: string;
  name: string;
  teamName: string;
  killCount: number;
  deathCount: number;
  assistCount: number;
  headshotPercentage: number;
  averageDamagePerRound: number;
  kast: number;
  hltvRating2: number;
  mvpCount: number;
  twoKillCount: number;
  threeKillCount: number;
  fourKillCount: number;
  fiveKillCount: number;
};

export type MatchSummary = {
  checksum: string;
  demoPath: string;
  date: string;
  game: Game;
  source: DemoSource;
  mapName: string;
  tickrate: number;
  tickCount: number;
  duration: number;
  teamAName: string;
  teamAScore: number;
  teamBName: string;
  teamBScore: number;
  // Stats of the requested player, undefined when no player is requested.
  player: MatchSummaryPlayer | undefined;
};

type Options = {
  limit: number;
  steamId?: string;
  mapName?: string;
};

// Lightweight query returning the latest analyzed matches, used by the CLI to let scripts pick matches to process.
export async function fetchLatestMatchesSummary({ limit, steamId, mapName }: Options): Promise<MatchSummary[]> {
  let query = db
    .selectFrom('matches')
    .innerJoin('demos', 'demos.checksum', 'matches.checksum')
    .innerJoin('teams as teamA', (join) => {
      return join.onRef('teamA.match_checksum', '=', 'matches.checksum').on('teamA.letter', '=', TeamLetter.A);
    })
    .innerJoin('teams as teamB', (join) => {
      return join.onRef('teamB.match_checksum', '=', 'matches.checksum').on('teamB.letter', '=', TeamLetter.B);
    })
    .select([
      'matches.checksum',
      'matches.demo_path',
      'demos.date',
      'demos.game',
      'demos.source',
      'demos.map_name',
      'demos.tickrate',
      'demos.tick_count',
      'demos.duration',
      'teamA.name as teamAName',
      'teamA.score as teamAScore',
      'teamB.name as teamBName',
      'teamB.score as teamBScore',
    ])
    .orderBy('demos.date', 'desc')
    .limit(limit);

  if (mapName) {
    query = query.where('demos.map_name', '=', mapName);
  }

  if (steamId) {
    query = query.where((eb) => {
      return eb.exists(
        eb
          .selectFrom('players')
          .select('players.steam_id')
          .whereRef('players.match_checksum', '=', 'matches.checksum')
          .where('players.steam_id', '=', steamId),
      );
    });
  }

  const rows = await query.execute();
  const playerRows =
    steamId && rows.length > 0
      ? await db
          .selectFrom('players')
          .select([
            'match_checksum',
            'steam_id',
            'name',
            'team_name',
            'kill_count',
            'death_count',
            'assist_count',
            'headshot_percentage',
            'average_damage_per_round',
            'kast',
            'hltv_rating_2',
            'mvp_count',
            'two_kill_count',
            'three_kill_count',
            'four_kill_count',
            'five_kill_count',
          ])
          .where('steam_id', '=', steamId)
          .where(
            'match_checksum',
            'in',
            rows.map((row) => row.checksum),
          )
          .execute()
      : [];

  return rows.map((row) => {
    const playerRow = playerRows.find((playerRow) => playerRow.match_checksum === row.checksum);

    return {
      checksum: row.checksum,
      demoPath: row.demo_path,
      date: new Date(row.date).toISOString(),
      game: row.game,
      source: row.source,
      mapName: row.map_name,
      tickrate: row.tickrate,
      tickCount: row.tick_count,
      duration: row.duration,
      teamAName: row.teamAName,
      teamAScore: row.teamAScore,
      teamBName: row.teamBName,
      teamBScore: row.teamBScore,
      player: playerRow
        ? {
            steamId: playerRow.steam_id,
            name: playerRow.name,
            teamName: playerRow.team_name,
            killCount: playerRow.kill_count,
            deathCount: playerRow.death_count,
            assistCount: playerRow.assist_count,
            headshotPercentage: playerRow.headshot_percentage,
            averageDamagePerRound: playerRow.average_damage_per_round,
            kast: playerRow.kast,
            hltvRating2: playerRow.hltv_rating_2,
            mvpCount: playerRow.mvp_count,
            twoKillCount: playerRow.two_kill_count,
            threeKillCount: playerRow.three_kill_count,
            fourKillCount: playerRow.four_kill_count,
            fiveKillCount: playerRow.five_kill_count,
          }
        : undefined,
    };
  });
}
