import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Sent to feed hosts and Podcast Index. Podcast Index rejects placeholder contact URLs such as
// example.com; add a real one (e.g. `(+https://yourapp.com/bot)`) once the app has a home.
export const USER_AGENT = 'PodcastApp/0.1';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class FeedFetchError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export type FetchFeedResult =
  | { notModified: true }
  | { notModified: false; xml: string; etag: string | null; lastModified: string | null; finalUrl: string };

export type FetchFeed = (
  url: string,
  cache?: { etag: string | null; lastModified: string | null } | null,
) => Promise<FetchFeedResult>;

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** Feed URLs come from users, so refuse anything that points inside our network. */
async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FeedFetchError('Only http and https feed URLs are supported', 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new FeedFetchError('Feed URL must point to a public host', 400);
  }
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FeedFetchError('Feed is larger than 20 MB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const fetchFeed: FetchFeed = async (input, cache) => {
  let url = new URL(input);
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  };
  if (cache?.etag) headers['If-None-Match'] = cache.etag;
  if (cache?.lastModified) headers['If-Modified-Since'] = cache.lastModified;

  // Follow redirects by hand so every hop is checked against private addresses.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    let res: Response;
    try {
      res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new FeedFetchError(`Could not reach feed: ${(err as Error).message}`);
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && res.status !== 304 && location) {
      url = new URL(location, url);
      continue;
    }
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new FeedFetchError(`Feed returned HTTP ${res.status}`);

    return {
      notModified: false,
      xml: await readLimited(res),
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      finalUrl: url.toString(),
    };
  }
  throw new FeedFetchError('Too many redirects');
};
