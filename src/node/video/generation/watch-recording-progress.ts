import fs from 'fs-extra';
import { Game } from 'csdm/common/types/counter-strike';
import { getCounterStrikePluginLogFilePath } from 'csdm/node/counter-strike/get-counter-strike-log-file-path';

// Marker echoed in the game console at the beginning of each sequence, the CS2 server plugin logs every executed
// command in its log file, it lets us know which sequence is being recorded without communicating with the plugin.
const SEQUENCE_START_MARKER = 'CSDM_SEQUENCE_START';

export function buildSequenceStartCommand(sequenceNumber: number) {
  return `echo ${SEQUENCE_START_MARKER} ${sequenceNumber}`;
}

const markerRegex = new RegExp(`Executing: echo ${SEQUENCE_START_MARKER} (\\d+)`, 'g');

// Returns the sequence numbers found in the given log content.
export function findStartedSequenceNumbers(content: string): number[] {
  return Array.from(content.matchAll(markerRegex), (match) => Number(match[1]));
}

export type RecordingProgressWatcher = {
  stop: () => void;
};

/**
 * Polls the CS2 plugin log file and calls onSequenceStart each time a new sequence recording starts.
 * CS:GO is not supported because its plugin doesn't log executed commands.
 */
export async function watchRecordingProgress(
  game: Game,
  onSequenceStart: (sequenceNumber: number) => void,
): Promise<RecordingProgressWatcher> {
  const noop = { stop: () => {} };
  if (game !== Game.CS2) {
    return noop;
  }

  let logFilePath: string;
  try {
    logFilePath = await getCounterStrikePluginLogFilePath(game);
  } catch (error) {
    logger.warn('Cannot watch the recording progress, the CS2 plugin log file path is unknown');
    logger.warn(error);
    return noop;
  }

  let offset = 0;
  let isReading = false;
  let lastSequenceNumber: number | undefined;
  // Content after the last line break, a line may be written while we are reading the file.
  let pendingContent = '';
  // Ignore the content of a previous game session, the plugin also deletes it when the game starts.
  await fs.remove(logFilePath).catch(() => {});

  const readNewContent = async () => {
    if (isReading) {
      return;
    }
    isReading = true;
    try {
      const stats = await fs.stat(logFilePath).catch(() => undefined);
      // The file doesn't exist yet or it has been recreated by the plugin.
      if (!stats || stats.size < offset) {
        offset = 0;
        pendingContent = '';
      }
      if (!stats || stats.size === offset) {
        return;
      }

      const fileHandle = await fs.promises.open(logFilePath, 'r');
      try {
        const length = stats.size - offset;
        const buffer = Buffer.alloc(length);
        await fileHandle.read(buffer, 0, length, offset);
        offset = stats.size;
        const content = pendingContent + buffer.toString('utf8');
        const lastLineBreakIndex = content.lastIndexOf('\n');
        pendingContent = content.slice(lastLineBreakIndex + 1);
        for (const sequenceNumber of findStartedSequenceNumbers(content.slice(0, lastLineBreakIndex + 1))) {
          if (sequenceNumber !== lastSequenceNumber) {
            lastSequenceNumber = sequenceNumber;
            onSequenceStart(sequenceNumber);
          }
        }
      } finally {
        await fileHandle.close();
      }
    } catch (error) {
      logger.debug('Error while reading the CS2 plugin log file');
      logger.debug(error);
    } finally {
      isReading = false;
    }
  };

  const intervalId = setInterval(readNewContent, 1000);

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
}
