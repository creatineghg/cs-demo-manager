import path from 'node:path';
import { parseArgs } from 'node:util';
import { Command } from './command';
import { CliOutput } from 'csdm/cli/cli-output';
import { migrateSettings } from 'csdm/node/settings/migrate-settings';
import { InvalidArgument } from 'csdm/cli/errors/invalid-argument';
import { getOrAnalyzeMatch } from 'csdm/cli/get-or-analyze-match';
import { parseWeaponNames } from 'csdm/cli/parse-weapon-names';
import { buildPlayerHighlights, keepBestHighlights } from 'csdm/common/video/highlights/build-player-highlights';
import type { WeaponName } from 'csdm/common/types/counter-strike';
import { isErrorCode } from 'csdm/common/is-error-code';
import { getErrorCodeMessage } from 'csdm/cli/get-error-code-message';

export class HighlightsCommand extends Command {
  public static Name = 'highlights';
  private readonly steamIdsFlag = 'steamids';
  private readonly minKillsInRoundFlag = 'min-kills-in-round';
  private readonly topFlag = 'top';
  private readonly roundsFlag = 'rounds';
  private readonly weaponsFlag = 'weapons';
  private readonly headshotsOnlyFlag = 'headshots-only';
  private readonly noAnalyzeFlag = 'no-analyze';
  private readonly jsonFlag = 'json';

  public getDescription() {
    return 'List the highlights (multi-kills, clutches, special kills) of players in a demo.';
  }

  public printHelp() {
    console.log(this.getDescription());
    console.log('');
    console.log(`Usage: csdm ${HighlightsCommand.Name} <demoPath> --${this.steamIdsFlag} <id1,id2> [options]`);
    console.log('');
    console.log('The demo is analyzed first if it is not in the database yet.');
    console.log('Each highlight is a round of a player with its kills, clutch info, a score and suggested ticks.');
    console.log('');
    console.log('Options:');
    console.log(`  --${this.steamIdsFlag} <steamId1,steamId2>  Players to get highlights for (required).`);
    console.log(`  --${this.minKillsInRoundFlag} <number>      Ignore rounds with less kills (won clutches are kept).`);
    console.log(`  --${this.topFlag} <number>                  Keep only the N highlights with the best score.`);
    console.log(`  --${this.roundsFlag} <1,2,...>              Only these rounds.`);
    console.log(`  --${this.weaponsFlag} <ak47,awp,...>        Only kills done with these weapons.`);
    console.log(`  --${this.headshotsOnlyFlag}                 Only headshot kills.`);
    console.log(
      `  --${this.noAnalyzeFlag}                     Fail instead of analyzing the demo when not in the database.`,
    );
    console.log(`  --${this.jsonFlag}                          Print the result as JSON.`);
    console.log('');
    console.log('Example:');
    console.log(
      `    csdm ${HighlightsCommand.Name} "C:\\demos\\match.dem" --${this.steamIdsFlag} 76561198000000000 --${this.minKillsInRoundFlag} 3 --json`,
    );
  }

  public async run() {
    let output = new CliOutput(this.args.includes(`--${this.jsonFlag}`));
    try {
      const { values, positionals } = parseArgs({
        options: {
          ...this.commonArgs,
          help: { type: 'boolean' },
          [this.steamIdsFlag]: { type: 'string' },
          [this.minKillsInRoundFlag]: { type: 'string' },
          [this.topFlag]: { type: 'string' },
          [this.roundsFlag]: { type: 'string' },
          [this.weaponsFlag]: { type: 'string' },
          [this.headshotsOnlyFlag]: { type: 'boolean' },
          [this.noAnalyzeFlag]: { type: 'boolean' },
          [this.jsonFlag]: { type: 'boolean' },
        },
        allowPositionals: true,
        args: this.args,
      });

      if (values.help) {
        this.printHelp();
        return;
      }
      output = new CliOutput(values[this.jsonFlag] === true);

      const [demoPathArg] = positionals;
      if (typeof demoPathArg !== 'string' || !demoPathArg.endsWith('.dem')) {
        throw new InvalidArgument('Missing or invalid demo path');
      }
      const demoPath = path.resolve(demoPathArg);

      const steamIds = (values[this.steamIdsFlag] ?? '')
        .split(',')
        .map((steamId) => steamId.trim())
        .filter((steamId) => steamId !== '');
      if (steamIds.length === 0) {
        throw new InvalidArgument(`The --${this.steamIdsFlag} option is required`);
      }

      const minKillsInRound = this.parsePositiveInteger(values[this.minKillsInRoundFlag], this.minKillsInRoundFlag);
      const top = this.parsePositiveInteger(values[this.topFlag], this.topFlag);
      const rounds = this.parseRounds(values[this.roundsFlag]);
      const weaponsValue = values[this.weaponsFlag];
      const weapons: WeaponName[] = weaponsValue ? parseWeaponNames(weaponsValue) : [];

      await migrateSettings();
      await this.initDatabaseConnection();
      const { match } = await getOrAnalyzeMatch({
        demoPath,
        output,
        analyze: values[this.noAnalyzeFlag] !== true,
        connectToDaemon: () => this.connectToDaemon(),
      });

      let highlights = buildPlayerHighlights({
        match,
        steamIds,
        minKillsInRound,
        rounds,
        weapons,
        headshotsOnly: values[this.headshotsOnlyFlag] === true,
      });
      if (top !== undefined) {
        highlights = keepBestHighlights(highlights, top);
      }

      const result = {
        checksum: match.checksum,
        demoPath: match.demoFilePath,
        mapName: match.mapName,
        game: match.game,
        tickrate: match.tickrate,
        highlights,
      };
      output.result(result, () => {
        if (highlights.length === 0) {
          return ['No highlights found'];
        }

        return highlights.map((highlight) => {
          const clutch = highlight.clutch?.won ? ` clutch 1v${highlight.clutch.opponentCount}` : '';
          const weapons = [...new Set(highlight.kills.map((kill) => kill.weaponName))].join(',');
          return `Round ${highlight.roundNumber} ${highlight.playerName}: ${highlight.killCount}K (${highlight.headshotCount} HS)${clutch} [${weapons}] score ${highlight.score} ticks ${highlight.startTick}-${highlight.endTick}`;
        });
      });
    } catch (error) {
      if (isErrorCode(error)) {
        output.error(getErrorCodeMessage(error));
      } else {
        output.error(error instanceof Error ? error.message : String(error));
        if (error instanceof InvalidArgument && !output.isJson) {
          this.printHelp();
        }
      }
      this.exitWithFailure();
    }
  }

  private parsePositiveInteger(value: string | undefined, flag: string) {
    if (value === undefined) {
      return undefined;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
      throw new InvalidArgument(`--${flag} must be a positive integer`);
    }

    return number;
  }

  private parseRounds(value: string | undefined) {
    if (value === undefined) {
      return [];
    }

    return value.split(',').map((round) => {
      const number = Number(round.trim());
      if (!Number.isInteger(number) || number < 1) {
        throw new InvalidArgument(`Invalid round number: ${round}`);
      }
      return number;
    });
  }
}
