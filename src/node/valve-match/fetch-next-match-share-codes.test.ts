import { describe, expect, it } from 'vite-plus/test';
import { fetchNextMatchShareCodes, ShareCodeHistoryError } from './fetch-next-match-share-codes';

function buildFetch(responses: Array<{ status: number; nextcode?: string }>) {
  const requestedCodes: string[] = [];
  const fetchFunction = ((url: URL) => {
    requestedCodes.push(url.searchParams.get('knowncode') ?? '');
    const response = responses.shift() ?? { status: 202, nextcode: 'n/a' };
    return Promise.resolve(
      new Response(JSON.stringify({ result: { nextcode: response.nextcode } }), { status: response.status }),
    );
  }) as typeof fetch;

  return { fetchFunction, requestedCodes };
}

const options = {
  steamApiKey: 'key',
  steamId: '76561198000000000',
  authenticationCode: 'AAAA-AAAAA-AAAA',
  knownShareCode: 'CSGO-known',
};

describe('fetchNextMatchShareCodes', () => {
  it('should follow the share codes until no newer match is available', async () => {
    const { fetchFunction, requestedCodes } = buildFetch([
      { status: 200, nextcode: 'CSGO-1' },
      { status: 200, nextcode: 'CSGO-2' },
      { status: 202, nextcode: 'n/a' },
    ]);

    await expect(fetchNextMatchShareCodes({ ...options, fetchFunction })).resolves.toEqual(['CSGO-1', 'CSGO-2']);
    expect(requestedCodes).toEqual(['CSGO-known', 'CSGO-1', 'CSGO-2']);
  });

  it('should stop when the next code is n/a', async () => {
    const { fetchFunction } = buildFetch([{ status: 200, nextcode: 'n/a' }]);

    await expect(fetchNextMatchShareCodes({ ...options, fetchFunction })).resolves.toEqual([]);
  });

  it('should respect the max count', async () => {
    const { fetchFunction } = buildFetch([
      { status: 200, nextcode: 'CSGO-1' },
      { status: 200, nextcode: 'CSGO-2' },
    ]);

    await expect(fetchNextMatchShareCodes({ ...options, fetchFunction, maxCount: 1 })).resolves.toEqual(['CSGO-1']);
  });

  it('should throw explicit errors', async () => {
    await expect(
      fetchNextMatchShareCodes({ ...options, fetchFunction: buildFetch([{ status: 403 }]).fetchFunction }),
    ).rejects.toBeInstanceOf(ShareCodeHistoryError);
    await expect(
      fetchNextMatchShareCodes({ ...options, fetchFunction: buildFetch([{ status: 412 }]).fetchFunction }),
    ).rejects.toThrow('CSGO-known');
  });
});
