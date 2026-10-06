import type { DemoSource } from 'csdm/common/types/counter-strike';
import { CliClientMessageName } from 'csdm/server/messages/cli-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { AnalysisStatus } from 'csdm/common/types/analysis-status';
import type { Analysis } from 'csdm/common/types/analysis';
import { getErrorCodeMessage } from 'csdm/cli/get-error-code-message';
import { isErrorCode } from 'csdm/common/is-error-code';
import type { CliWebSocketClient } from 'csdm/cli/web-socket/cli-web-socket-client';
import type { CliOutput } from 'csdm/cli/cli-output';

type Options = {
  client: CliWebSocketClient;
  output: CliOutput;
  demoPaths: string[];
  force: boolean;
  analyzePositions: boolean;
  source: DemoSource | undefined;
};

type Result = {
  hasError: boolean;
};

/**
 * Adds the demos to the daemon analyses queue and waits until all of them are analyzed and inserted in the database.
 * Demos already in the database are skipped unless force is true.
 */
export async function analyzeDemos({
  client,
  output,
  demoPaths,
  force,
  analyzePositions,
  source,
}: Options): Promise<Result> {
  const pendingChecksums = new Set<string>();
  const lastStatusPerChecksum = new Map<string, AnalysisStatus>();
  let hasError = false;
  let resolveCompletion: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  const markAnalysisAsDone = (checksum: string) => {
    pendingChecksums.delete(checksum);
    if (pendingChecksums.size === 0) {
      resolveCompletion();
    }
  };

  const onAnalysisUpdated = (analysis: Analysis) => {
    const { demoChecksum: checksum, demoPath, status } = analysis;
    if (!pendingChecksums.has(checksum) || lastStatusPerChecksum.get(checksum) === status) {
      return;
    }
    lastStatusPerChecksum.set(checksum, status);

    switch (status) {
      case AnalysisStatus.Analyzing:
        output.logOrEvent(`Analyzing demo ${demoPath}...`, 'analysis', { status: 'analyzing', demoPath, checksum });
        break;
      case AnalysisStatus.Inserting:
        output.logOrEvent(`Inserting match into database ${demoPath}...`, 'analysis', {
          status: 'inserting',
          demoPath,
          checksum,
        });
        break;
      case AnalysisStatus.InsertSuccess:
        output.logOrEvent(`Demo ${demoPath} inserted into the database`, 'analysis', {
          status: 'success',
          demoPath,
          checksum,
        });
        markAnalysisAsDone(checksum);
        break;
      case AnalysisStatus.AnalyzeError:
      case AnalysisStatus.InsertError: {
        hasError = true;
        const message =
          status === AnalysisStatus.AnalyzeError
            ? `Error analyzing demo ${demoPath}`
            : `Error inserting match into database ${demoPath}`;
        output.error(message, { demoPath, checksum, details: analysis.output });
        if (!output.isJson && analysis.output !== '') {
          console.error(analysis.output);
        }
        markAnalysisAsDone(checksum);
        break;
      }
    }
  };

  client.on(ServerPushMessageName.AnalysisUpdated, onAnalysisUpdated);

  const { addedDemos, skippedDemoPaths } = await client.send(
    {
      name: CliClientMessageName.AddDemoPathsToAnalyses,
      payload: {
        demoPaths,
        force,
        analyzePositions,
        source,
      },
    },
    { timeoutMs: 20_000 },
  );

  for (const demoPath of skippedDemoPaths) {
    output.logOrEvent(`Demo ${demoPath} already in database, skipping this demo.`, 'analysis', {
      status: 'skipped',
      demoPath,
    });
  }
  for (const { checksum } of addedDemos) {
    pendingChecksums.add(checksum);
  }

  if (pendingChecksums.size > 0) {
    const daemonStatusPollIntervalMs = 30_000;
    // Safety net in case a terminal push message never arrives (e.g. the analysis has been removed from the queue
    // through the GUI). Push messages and the status reply arrive on the same socket, so a non-busy status with
    // pending analyses means they will never complete.
    const pollIntervalId = setInterval(async () => {
      try {
        const daemon = await client.send({ name: CliClientMessageName.GetDaemonStatus });
        if (!daemon.busy && pendingChecksums.size > 0) {
          hasError = true;
          output.error('Some analyses did not complete, check the demos in the GUI or re-run the command.');
          resolveCompletion();
        }
      } catch (error) {
        hasError = true;
        let errorMessage: string;
        if (isErrorCode(error)) {
          errorMessage = getErrorCodeMessage(error);
        } else {
          errorMessage = error instanceof Error ? error.message : 'The daemon is not responding.';
        }
        output.error(errorMessage);
        resolveCompletion();
      }
    }, daemonStatusPollIntervalMs);

    await completion;
    clearInterval(pollIntervalId);
  }

  client.off(ServerPushMessageName.AnalysisUpdated, onAnalysisUpdated);

  return { hasError };
}
