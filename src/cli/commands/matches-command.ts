import { parseArgs } from 'node:util';
import { Command } from './command';
import { CliOutput } from 'csdm/cli/cli-output';
import { fetchLatestMatchesSummary } from 'csdm/node/database/matches/fetch-latest-matches-summary';
import { migrateSettings } from 'csdm/node/settings/migrate-settings';

export class MatchesCommand extends Command {
  public static Name = 'matches';
  private readonly limitFlag = 'limit';
  private readonly steamIdFlag = 'steamid';
  private readonly mapFlag = 'map';
  private readonly jsonFlag = 'json';

  public getDescription() {
    return 'List the latest analyzed matches, optionally with the stats of a player.';
  }

  public printHelp() {
    console.log(this.getDescription());
    console.log('');
    console.log(
      `Usage: csdm ${MatchesCommand.Name} [--${this.limitFlag} <number>] [--${this.steamIdFlag} <steamId>] [--${this.mapFlag} <mapName>] [--${this.jsonFlag}]`,
    );
    console.log('');
    console.log(`  --${this.limitFlag} <number>   Number of matches to list, default 10.`);
    console.log(`  --${this.steamIdFlag} <steamId> Only matches where the player played, includes the player's stats.`);
    console.log(`  --${this.mapFlag} <mapName>     Only matches played on the map, e.g. de_dust2.`);
    console.log(`  --${this.jsonFlag}              Print the result as JSON.`);
    console.log('');
    console.log('Examples:');
    console.log(`    csdm ${MatchesCommand.Name} --${this.steamIdFlag} 76561198000000000 --${this.limitFlag} 5 --json`);
  }

  public async run() {
    const { values } = parseArgs({
      options: {
        ...this.commonArgs,
        help: { type: 'boolean' },
        [this.limitFlag]: { type: 'string' },
        [this.steamIdFlag]: { type: 'string' },
        [this.mapFlag]: { type: 'string' },
        [this.jsonFlag]: { type: 'boolean' },
      },
      args: this.args,
    });

    if (values.help) {
      this.printHelp();
      return;
    }

    const output = new CliOutput(values[this.jsonFlag] === true);
    const limit = values[this.limitFlag] === undefined ? 10 : Number(values[this.limitFlag]);
    if (!Number.isInteger(limit) || limit <= 0) {
      output.error('The limit must be a positive integer');
      return this.exitWithFailure();
    }

    await migrateSettings();
    await this.initDatabaseConnection();

    const matches = await fetchLatestMatchesSummary({
      limit,
      steamId: values[this.steamIdFlag],
      mapName: values[this.mapFlag],
    });

    output.result(matches, () => {
      if (matches.length === 0) {
        return ['No matches found'];
      }

      return matches.map((match) => {
        let line = `${match.date} ${match.mapName} ${match.teamAName} ${match.teamAScore}-${match.teamBScore} ${match.teamBName} ${match.checksum} "${match.demoPath}"`;
        const { player } = match;
        if (player) {
          line += ` | ${player.name}: ${player.killCount}/${player.deathCount}/${player.assistCount} rating ${player.hltvRating2} 3k:${player.threeKillCount} 4k:${player.fourKillCount} 5k:${player.fiveKillCount}`;
        }

        return line;
      });
    });
  }
}
