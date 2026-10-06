import type { Match } from 'csdm/common/types/match';
import type { Demo } from 'csdm/common/types/demo';
import { getDemoFromFilePath } from 'csdm/node/demo/get-demo-from-file-path';
import { fetchMatchesByChecksums } from 'csdm/node/database/matches/fetch-matches-by-checksums';
import type { CliWebSocketClient } from 'csdm/cli/web-socket/cli-web-socket-client';
import type { CliOutput } from 'csdm/cli/cli-output';
import { analyzeDemos } from 'csdm/cli/analyze-demos';

type Options = {
  demoPath: string;
  output: CliOutput;
  // When true and the demo is not in the database yet, it's analyzed first.
  analyze: boolean;
  connectToDaemon: () => Promise<CliWebSocketClient>;
};

/**
 * Returns the match of the given demo from the database.
 * The demo is analyzed if required so scripts don't have to call the analyze command first.
 * The database connection must be initialized.
 */
export async function getOrAnalyzeMatch({
  demoPath,
  output,
  analyze,
  connectToDaemon,
}: Options): Promise<{ demo: Demo; match: Match }> {
  const demo = await getDemoFromFilePath(demoPath);
  let [match] = await fetchMatchesByChecksums([demo.checksum]);
  if (match) {
    return { demo, match };
  }

  if (!analyze) {
    throw new Error('Match not found in database. Make sure the demo has been analyzed.');
  }

  output.logOrEvent('The demo is not in the database, analyzing it...', 'analysis', {
    status: 'required',
    demoPath,
  });
  const client = await connectToDaemon();
  const { hasError } = await analyzeDemos({
    client,
    output,
    demoPaths: [demoPath],
    force: false,
    analyzePositions: false,
    source: undefined,
  });
  client.close();
  if (hasError) {
    throw new Error(`Failed to analyze the demo ${demoPath}`);
  }

  [match] = await fetchMatchesByChecksums([demo.checksum]);
  if (!match) {
    throw new Error('Match not found in database after the analysis.');
  }

  return { demo, match };
}
