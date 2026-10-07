import path from 'node:path';
import fs from 'fs-extra';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';

// Saved locally so the next "dl-valve --history" run only fetches matches played since the last run.
export type ShareCodeHistoryEntry = {
  authenticationCode: string;
  lastShareCode: string;
};

type State = Record<string, ShareCodeHistoryEntry>;

function getStateFilePath() {
  return path.join(getAppFolderPath(), 'share-code-history.json');
}

async function readState(): Promise<State> {
  try {
    return await fs.readJson(getStateFilePath());
  } catch {
    return {};
  }
}

export async function getShareCodeHistoryEntry(steamId: string): Promise<ShareCodeHistoryEntry | undefined> {
  const state = await readState();

  return state[steamId];
}

export async function saveShareCodeHistoryEntry(steamId: string, entry: ShareCodeHistoryEntry) {
  const state = await readState();
  state[steamId] = entry;
  await fs.ensureDir(path.dirname(getStateFilePath()));
  await fs.writeJson(getStateFilePath(), state, { spaces: 2 });
}
