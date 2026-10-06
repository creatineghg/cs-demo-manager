import os from 'node:os';
import { parseArgs } from 'node:util';
import fs from 'fs-extra';
import { Command } from './command';
import { CliOutput } from 'csdm/cli/cli-output';
import { Game } from 'csdm/common/types/counter-strike';
import { migrateSettings } from 'csdm/node/settings/migrate-settings';
import { getSettingsFilePath } from 'csdm/node/settings/get-settings-file-path';
import { isWindows } from 'csdm/node/os/is-windows';
import { isSteamRunning } from 'csdm/node/counter-strike/is-steam-running';
import { getCounterStrikeExecutablePath } from 'csdm/node/counter-strike/get-counter-strike-executable-path';
import { getFfmpegExecutablePath } from 'csdm/node/video/ffmpeg/ffmpeg-location';
import { getFfmpegVersionFromExecutable } from 'csdm/node/video/ffmpeg/get-ffmpeg-version-from-executable';
import { getHlaeExecutablePath } from 'csdm/node/video/hlae/hlae-location';
import { getInstalledHlaeVersion } from 'csdm/node/video/hlae/get-installed-hlae-version';
import { testFfmpegPresets, type FfmpegPresetTestResult } from 'csdm/node/video/ffmpeg/detect-ffmpeg-presets';
import { CliClientMessageName } from 'csdm/server/messages/cli-client-message-name';
import { isErrorCode } from 'csdm/common/is-error-code';
import { getErrorCodeMessage } from 'csdm/cli/get-error-code-message';
import pkg from '../../../package.json';

type Check = {
  name: string;
  ok: boolean;
  details: string;
};

export class DoctorCommand extends Command {
  public static Name = 'doctor';
  private readonly jsonFlag = 'json';
  private readonly skipEncodersFlag = 'skip-encoders';

  public getDescription() {
    return 'Check that everything required to analyze demos and record videos is available.';
  }

  public printHelp() {
    console.log(this.getDescription());
    console.log('');
    console.log(`Usage: csdm ${DoctorCommand.Name} [--${this.skipEncodersFlag}] [--${this.jsonFlag}]`);
    console.log('');
    console.log('Checks the database, Steam, Counter-Strike, HLAE and FFmpeg installations.');
    console.log('It also test-encodes a few frames with each FFmpeg encoding preset to list the ones usable on this');
    console.log('computer, use one of them with "csdm video --preset <id>" or "--preset auto".');
    console.log('');
    console.log(`  --${this.skipEncodersFlag}  Don't test the FFmpeg encoding presets.`);
    console.log(`  --${this.jsonFlag}           Print the result as JSON.`);
  }

  public async run() {
    const { values } = parseArgs({
      options: {
        ...this.commonArgs,
        help: { type: 'boolean' },
        [this.jsonFlag]: { type: 'boolean' },
        [this.skipEncodersFlag]: { type: 'boolean' },
      },
      args: this.args,
    });

    if (values.help) {
      this.printHelp();
      return;
    }

    const output = new CliOutput(values[this.jsonFlag] === true);
    const checks: Check[] = [];
    const settings = await migrateSettings();

    checks.push({ name: 'settings', ok: true, details: getSettingsFilePath() });
    checks.push(await this.checkDatabase(settings.database.mode));
    checks.push(await this.checkSteam());
    checks.push(await this.checkGame(Game.CS2));
    if (isWindows) {
      checks.push(await this.checkHlae());
    }
    const ffmpegCheck = await this.checkFfmpeg();
    checks.push(ffmpegCheck);

    let presets: FfmpegPresetTestResult[] = [];
    if (ffmpegCheck.ok && values[this.skipEncodersFlag] !== true) {
      output.log('Testing FFmpeg encoding presets...');
      presets = await testFfmpegPresets(await getFfmpegExecutablePath());
    }

    const result = {
      version: pkg.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      checks,
      ffmpegPresets: presets,
    };

    output.result(result, () => {
      const lines = [`CS Demo Manager ${pkg.version} - ${result.platform}`, ''];
      for (const check of checks) {
        lines.push(`[${check.ok ? 'OK' : 'KO'}] ${check.name}: ${check.details}`);
      }
      if (presets.length > 0) {
        lines.push('', 'FFmpeg encoding presets:');
        for (const preset of presets) {
          lines.push(`  [${preset.isWorking ? 'OK' : 'KO'}] ${preset.id.padEnd(12)} ${preset.name}`);
        }
      }

      return lines;
    });

    // The database must be reachable to do anything, other checks may be optional depending on the use case.
    const databaseCheck = checks.find((check) => check.name === 'database');
    if (databaseCheck && !databaseCheck.ok) {
      this.exitWithFailure();
    }
  }

  private async checkDatabase(mode: string): Promise<Check> {
    try {
      const client = await this.connectToDaemon();
      try {
        await client.send({ name: CliClientMessageName.EnsureDatabaseConnection }, { timeoutMs: null });
      } finally {
        client.close();
      }

      return { name: 'database', ok: true, details: `connected (${mode} mode)` };
    } catch (error) {
      const message = isErrorCode(error) ? getErrorCodeMessage(error) : error instanceof Error ? error.message : '';
      return { name: 'database', ok: false, details: `${mode} mode: ${message}` };
    }
  }

  private async checkSteam(): Promise<Check> {
    const isRunning = await isSteamRunning();
    return {
      name: 'steam',
      ok: isRunning,
      details: isRunning ? 'running' : 'not running, it is required to start Counter-Strike',
    };
  }

  private async checkGame(game: Game): Promise<Check> {
    try {
      const executablePath = await getCounterStrikeExecutablePath(game);
      return { name: game, ok: true, details: executablePath };
    } catch {
      return { name: game, ok: false, details: 'executable not found, set a custom location in the app settings' };
    }
  }

  private async checkHlae(): Promise<Check> {
    const executablePath = await getHlaeExecutablePath();
    const version = await getInstalledHlaeVersion();
    if (version === undefined) {
      return { name: 'hlae', ok: false, details: `not installed (${executablePath}), the video command installs it` };
    }

    return { name: 'hlae', ok: true, details: `${version} (${executablePath})` };
  }

  private async checkFfmpeg(): Promise<Check> {
    const executablePath = await getFfmpegExecutablePath();
    if (!(await fs.pathExists(executablePath))) {
      return { name: 'ffmpeg', ok: false, details: `not installed (${executablePath}), the video command installs it` };
    }

    try {
      const version = await getFfmpegVersionFromExecutable(executablePath);
      return { name: 'ffmpeg', ok: true, details: `${version} (${executablePath})` };
    } catch {
      return { name: 'ffmpeg', ok: false, details: `invalid executable ${executablePath}` };
    }
  }
}
