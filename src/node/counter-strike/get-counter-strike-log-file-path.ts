import path from 'node:path';
import fs from 'fs-extra';
import { Game } from 'csdm/common/types/counter-strike';
import { getCounterStrikeExecutablePath } from './get-counter-strike-executable-path';
import { FileNotFound } from '../filesystem/errors/file-not-found';
import { ErrorCode } from 'csdm/common/error-code';
import { getErrorCodeFromError } from 'csdm/server/get-error-code-from-error';
import { isLinux } from '../os/is-linux';

// Returns the path of the log file written by the CS:DM server plugin, it may not exist yet.
export async function getCounterStrikePluginLogFilePath(game: Game) {
  const executablePath = await getCounterStrikeExecutablePath(game);
  const executableDir = path.dirname(executablePath);

  return isLinux && game !== Game.CSGO
    ? path.join(executableDir, 'bin', 'linuxsteamrt64', 'csdm.log')
    : path.join(executableDir, 'csdm.log');
}

// Returns the path to the Counter-Strike log file which is next to the game executable.
export async function getCounterStrikeLogFilePath(game: Game) {
  let logFilePath = '';
  try {
    logFilePath = await getCounterStrikePluginLogFilePath(game);

    if (!(await fs.pathExists(logFilePath))) {
      throw new FileNotFound(logFilePath);
    }
    return logFilePath;
  } catch (error) {
    const errorCode = getErrorCodeFromError(error);
    if (errorCode === ErrorCode.UnknownError) {
      logger.error('Error getting Counter-Strike log file path');
      logger.error(error);
    }

    const notFoundCodes: ErrorCode[] = [
      ErrorCode.CounterStrikeExecutableNotFound,
      ErrorCode.CustomCounterStrikeExecutableNotFound,
    ];
    if (notFoundCodes.includes(errorCode)) {
      throw new FileNotFound(logFilePath);
    }

    throw error;
  }
}
