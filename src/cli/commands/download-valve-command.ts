import fs from 'fs-extra';
import { request } from 'undici';
import { pipeline } from 'node:stream';
import path from 'node:path';
import b2 from 'unbzip2-stream';
import util from 'node:util';
import { decodeMatchShareCode, InvalidShareCode } from 'csgo-sharecode';
import { startBoiler } from 'csdm/node/boiler/start-boiler';
import {
  type CDataGCCStrike15_v2_MatchInfo,
  type WatchableMatchInfo,
  CDataGCCStrike15_v2_MatchInfoSchema,
  toBinary,
} from 'csgo-protobuf';
import { SteamCommunicationError } from 'csdm/node/boiler/errors/steam-communication-error';
import { AlreadyConnected } from 'csdm/node/boiler/errors/already-connected';
import { SteamRestartRequired } from 'csdm/node/boiler/errors/steam-restart-required';
import { BoilerSteamNotRunning } from 'csdm/node/boiler/errors/boiler-steam-not-running';
import { UserNotConnected } from 'csdm/node/boiler/errors/user-not-connected';
import { NoMatchesFound } from 'csdm/node/boiler/errors/no-matches-found';
import { WriteFileError } from 'csdm/node/boiler/errors/write-file-error';
import { InvalidArgs } from 'csdm/node/boiler/errors/invalid-args';
import { MatchesInfoFileNotFound } from 'csdm/node/boiler/errors/matches-info-file-not-found';
import {
  buildMatchName,
  getLastRoundStatsMessage,
} from 'csdm/node/valve-match/get-valve-match-from-match-info-protobuf-message';
import { isDownloadLinkExpired } from 'csdm/node/download/is-download-link-expired';
import { DownloadBaseCommand } from './download-base-command';
import { SteamNotRunning } from 'csdm/node/counter-strike/launcher/errors/steam-not-running';
import { fetchNextMatchShareCodes } from 'csdm/node/valve-match/fetch-next-match-share-codes';
import { getShareCodeHistoryEntry, saveShareCodeHistoryEntry } from 'csdm/node/valve-match/share-code-history-state';
import { getSteamApiKey, isValidSteamApiKey } from 'csdm/node/steam-web-api/get-steam-api-key';
const streamPipeline = util.promisify(pipeline);

export class DownloadValveCommand extends DownloadBaseCommand {
  public static Name = 'dl-valve';
  private readonly shareCodes: string[] = [];
  private readonly historyFlag = '--history';
  private readonly steamIdFlag = '--steamid';
  private readonly authCodeFlag = '--auth-code';
  private readonly knownCodeFlag = '--known-code';
  private readonly steamApiKeyFlag = '--steam-api-key';
  private useHistory = false;
  private steamId: string | undefined;
  private authenticationCode: string | undefined;
  private knownShareCode: string | undefined;
  private steamApiKey: string | undefined;
  private demoPathBeingDownloaded: string | undefined;

  public getDescription() {
    return 'Download the last MM demos of the current Steam account or from share codes';
  }

  public printHelp() {
    console.log(this.getDescription());
    console.log('');
    console.log(`Usage: csdm ${DownloadValveCommand.Name} [shareCodes...] ${this.formatFlagForHelp(this.outputFlag)}`);
    console.log('');
    console.log(`The ${this.outputFlag} flag specify the directory where demos will be downloaded.`);
    console.log(`Default value in order of preference:`);
    console.log('\t1. Download folder specified in the application settings.');
    console.log('\t2. The Counter-Strike folder "replays".');
    console.log('\t3. The current directory.');
    console.log('');
    console.log('Examples:');
    console.log('');
    console.log('To download last MM demos of the current Steam account:');
    console.log(`    csdm ${DownloadValveCommand.Name}`);
    console.log('');
    console.log('To download demos from share codes:');
    console.log(
      `    csdm ${DownloadValveCommand.Name} CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`,
    );
    console.log('');
    console.log('To change the directory where demos will be downloaded:');
    console.log(`    csdm ${DownloadValveCommand.Name} ${this.outputFlag} "C:\\Users\\username\\Downloads"`);
    console.log('');
    console.log(
      `With ${this.historyFlag}, every match played since the last run is downloaded using the Steam match history API`,
    );
    console.log('instead of the recent games list of the game (limited to the last matches).');
    console.log(
      'The game authentication code and a share code of one of your matches are available at https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128',
    );
    console.log('They are saved locally after the first run, the next runs only need --history.');
    console.log(
      `    csdm ${DownloadValveCommand.Name} ${this.historyFlag} ${this.steamIdFlag} 76561198000000000 ${this.authCodeFlag} XXXX-XXXXX-XXXX ${this.knownCodeFlag} CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`,
    );
    console.log(`    ${this.steamApiKeyFlag} <key> overrides the Steam API key of the app settings.`);
  }

  public constructor(args: string[]) {
    super(args);
    process.on('SIGINT', this.onInterruptSignal);
  }

  public async run() {
    this.parseArgs();

    this.outputFolderPath = await this.getOutputFolder();
    await this.assertOutputFolderIsValid(this.outputFolderPath);

    if (this.useHistory) {
      await this.downloadMatchesFromHistory();
    } else if (this.shareCodes.length > 0) {
      for (const shareCode of this.shareCodes) {
        console.log(`Downloading match with share code ${shareCode}...`);
        const { matchId, reservationId, tvPort } = decodeMatchShareCode(shareCode);
        const matches = await this.fetchMatches([matchId.toString(), reservationId.toString(), tvPort.toString()]);
        if (matches.length === 0) {
          console.log('Demo link expired.');
          continue;
        }
        await this.processMatchInfo(matches[0]);
      }
    } else {
      console.log('Retrieving last MM matches...');
      const matches = await this.fetchMatches();
      if (matches.length === 0) {
        console.log('No matches found.');
        return;
      }

      for (const [index, match] of matches.entries()) {
        console.log(`Downloading match ${index + 1}/${matches.length}...`);
        await this.processMatchInfo(match);
      }
    }
  }

  protected parseArgs() {
    super.parseArgs(this.args);

    for (let index = 0; index < this.args.length; index++) {
      const arg = this.args[index];
      if (this.isFlagArgument(arg)) {
        switch (arg) {
          case this.outputFlag:
            if (this.args.length > index + 1) {
              index += 1;
              this.outputFolderPath = this.args[index];
            } else {
              console.log(`Missing ${this.outputFlag} value`);
              this.exitWithFailure();
            }
            break;
          case this.historyFlag:
            this.useHistory = true;
            break;
          case this.steamIdFlag:
          case this.authCodeFlag:
          case this.knownCodeFlag:
          case this.steamApiKeyFlag: {
            const value = this.args[index + 1];
            if (value === undefined || this.isFlagArgument(value)) {
              console.log(`Missing ${arg} value`);
              this.exitWithFailure();
            }
            index += 1;
            if (arg === this.steamIdFlag) {
              this.steamId = value;
            } else if (arg === this.authCodeFlag) {
              this.authenticationCode = value;
            } else if (arg === this.knownCodeFlag) {
              this.knownShareCode = value;
            } else {
              this.steamApiKey = value;
            }
            break;
          }
          default:
            console.log(`Unknown flag: ${arg}`);
            this.exitWithFailure();
        }
      } else {
        try {
          decodeMatchShareCode(arg);
          this.shareCodes.push(arg);
        } catch (error) {
          if (error instanceof InvalidShareCode) {
            console.log(`Invalid share code: ${arg}`);
          } else {
            console.error(error);
          }
          this.exitWithFailure();
        }
      }
    }
  }

  private async processMatchInfo(matchInfo: CDataGCCStrike15_v2_MatchInfo) {
    const watchInfo = matchInfo.watchablematchinfo as WatchableMatchInfo;
    const tvPort = watchInfo.tvPort as number;
    const serverIp = watchInfo.serverIp as number;
    const lastRoundMessage = getLastRoundStatsMessage(matchInfo);
    const lastRoundReservationId = lastRoundMessage.reservationid as bigint;

    const demoName = buildMatchName(lastRoundReservationId, tvPort, serverIp);
    const demoPath = path.join(this.outputFolderPath, `${demoName}.dem`);
    const demoAlreadyExists = await fs.pathExists(demoPath);
    if (demoAlreadyExists) {
      console.log(`Demo already exists at ${demoPath}`);
      return;
    }

    const demoUrl = lastRoundMessage.map;
    if (demoUrl === undefined) {
      console.log('Demo URL not found');
      return;
    }

    const isDemoLinkExpired = await isDownloadLinkExpired(demoUrl);
    if (isDemoLinkExpired) {
      console.log(`Demo link expired ${demoUrl}`);
      return;
    }

    const response = await request(demoUrl, { method: 'GET' });
    if (!response.body) {
      console.log('Request error');
      return;
    }

    this.demoPathBeingDownloaded = demoPath;
    const out = fs.createWriteStream(demoPath);
    await streamPipeline(response.body, b2(), out);
    await fs.writeFile(`${demoPath}.info`, toBinary(CDataGCCStrike15_v2_MatchInfoSchema, matchInfo));
    this.demoPathBeingDownloaded = undefined;
    console.log(`Demo downloaded at ${demoPath}`);
  }

  private async fetchMatches(args?: string[], failOnError = false) {
    try {
      const { matches } = await startBoiler({
        args,
      });

      return matches;
    } catch (error) {
      let message = 'An error occurred retrieving matches.';
      switch (true) {
        case error instanceof InvalidArgs:
          message = 'Invalid arguments provided to boiler.';
          break;
        case error instanceof MatchesInfoFileNotFound:
          message = 'Matches info file not found.';
          break;
        case error instanceof SteamCommunicationError:
          message =
            'Error while contacting Steam, make sure your Steam account is not currently in-game on another device, otherwise please retry later.';
          break;
        case error instanceof AlreadyConnected:
          message = 'You are already connected to the CS game coordinator, make sure to close CS and retry.';
          break;
        case error instanceof SteamRestartRequired:
          message = 'Steam needs to be restarted.';
          break;
        case error instanceof SteamNotRunning:
        case error instanceof BoilerSteamNotRunning:
          message = 'Steam is not running or the current account is not logged in.';
          break;
        case error instanceof UserNotConnected:
          message = 'Steam account not connected.';
          break;
        case error instanceof NoMatchesFound:
          return [];
        case error instanceof WriteFileError:
          message = 'An error occurred while writing matches file.';
          break;
      }

      if (failOnError) {
        throw new Error(message);
      }
      console.error(message);

      return [];
    }
  }

  private async downloadMatchesFromHistory() {
    const steamId = this.steamId;
    if (!steamId) {
      console.log(`The ${this.steamIdFlag} flag is required with ${this.historyFlag}`);
      return this.exitWithFailure();
    }

    const entry = await getShareCodeHistoryEntry(steamId);
    const authenticationCode = this.authenticationCode ?? entry?.authenticationCode;
    let lastShareCode = this.knownShareCode ?? entry?.lastShareCode;
    if (!authenticationCode || !lastShareCode) {
      console.log(
        `The game authentication code (${this.authCodeFlag}) and a known share code (${this.knownCodeFlag}) are required the first time.`,
      );
      return this.exitWithFailure();
    }
    try {
      decodeMatchShareCode(lastShareCode);
    } catch {
      console.log(`Invalid share code: ${lastShareCode}`);
      return this.exitWithFailure();
    }

    const steamApiKey = this.steamApiKey ?? (await getSteamApiKey());
    if (!isValidSteamApiKey(steamApiKey)) {
      console.log(`A Steam API key is required, set it in the app settings or use ${this.steamApiKeyFlag}.`);
      return this.exitWithFailure();
    }

    await saveShareCodeHistoryEntry(steamId, { authenticationCode, lastShareCode });

    console.log('Retrieving matches from the Steam match history...');
    let shareCodes: string[];
    try {
      shareCodes = await fetchNextMatchShareCodes({
        steamApiKey,
        steamId,
        authenticationCode,
        knownShareCode: lastShareCode,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return this.exitWithFailure();
    }

    // The known share code is downloaded too when it's provided explicitly, it's usually the latest match.
    if (this.knownShareCode && entry?.lastShareCode !== this.knownShareCode) {
      shareCodes.unshift(this.knownShareCode);
    }

    if (shareCodes.length === 0) {
      console.log('No new matches found. The Steam API may take a few minutes to return a match that just ended.');
      return;
    }

    for (const [index, shareCode] of shareCodes.entries()) {
      console.log(`Downloading match ${index + 1}/${shareCodes.length} (${shareCode})...`);
      const { matchId, reservationId, tvPort } = decodeMatchShareCode(shareCode);
      try {
        const matches = await this.fetchMatches(
          [matchId.toString(), reservationId.toString(), tvPort.toString()],
          true,
        );
        if (matches.length === 0) {
          console.log('Demo link expired.');
        } else {
          await this.processMatchInfo(matches[0]);
        }
      } catch (error) {
        // Stop here, the next run will retry from this match.
        console.error(error instanceof Error ? error.message : error);
        return this.exitWithFailure();
      }

      lastShareCode = shareCode;
      await saveShareCodeHistoryEntry(steamId, { authenticationCode, lastShareCode });
    }
  }

  private onInterruptSignal = async () => {
    if (this.demoPathBeingDownloaded) {
      await fs.remove(this.demoPathBeingDownloaded);
      await fs.remove(`${this.demoPathBeingDownloaded}.info`);
    }
    this.exit();
  };
}
