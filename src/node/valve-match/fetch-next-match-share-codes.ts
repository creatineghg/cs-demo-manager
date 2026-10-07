const API_URL = 'https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1';

export class ShareCodeHistoryError extends Error {}

type Options = {
  steamApiKey: string;
  steamId: string;
  // Game authentication code generated from the Steam help website, format XXXX-XXXXX-XXXX.
  authenticationCode: string;
  // Share code of a match played by the user, newer matches are returned.
  knownShareCode: string;
  maxCount?: number;
  fetchFunction?: typeof fetch;
};

type Response = {
  result?: {
    nextcode?: string;
  };
};

/**
 * Returns the share codes of the matches played after the known share code, from the oldest to the most recent, using
 * the official match history Steam API.
 * Unlike the recent games list of the game coordinator (limited to the last matches), it returns every match.
 * The API may return the most recent match a few minutes after it ended.
 */
export async function fetchNextMatchShareCodes({
  steamApiKey,
  steamId,
  authenticationCode,
  knownShareCode,
  maxCount = 100,
  fetchFunction = fetch,
}: Options): Promise<string[]> {
  const shareCodes: string[] = [];
  let currentShareCode = knownShareCode;
  while (shareCodes.length < maxCount) {
    const url = new URL(API_URL);
    url.searchParams.set('key', steamApiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('steamidkey', authenticationCode);
    url.searchParams.set('knowncode', currentShareCode);
    const response = await fetchFunction(url);

    switch (response.status) {
      case 200:
        break;
      // No newer match available (yet).
      case 202:
        return shareCodes;
      case 403:
        throw new ShareCodeHistoryError(
          'The Steam API key or the game authentication code is invalid for this Steam account.',
        );
      case 412:
        throw new ShareCodeHistoryError(`The known share code ${currentShareCode} doesn't belong to this account.`);
      case 429:
        throw new ShareCodeHistoryError('Too many requests to the Steam API, retry later.');
      default:
        throw new ShareCodeHistoryError(`The Steam API returned an unexpected status code ${response.status}.`);
    }

    const data = (await response.json()) as Response;
    const nextShareCode = data.result?.nextcode;
    if (!nextShareCode || nextShareCode === 'n/a') {
      return shareCodes;
    }

    shareCodes.push(nextShareCode);
    currentShareCode = nextShareCode;
  }

  return shareCodes;
}
