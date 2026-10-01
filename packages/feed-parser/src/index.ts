import { XMLParser } from 'fast-xml-parser';

export type ParsedEpisode = {
  guid: string;
  title: string;
  publishedAt: string | null;
  durationSec: number | null;
  enclosureUrl: string;
  enclosureType: string | null;
  enclosureBytes: number | null;
  showNotesHtml: string | null;
  artworkUrl: string | null;
  season: number | null;
  episodeNumber: number | null;
  transcriptUrl: string | null;
  chaptersUrl: string | null;
};

export type ParsedFeed = {
  title: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  language: string | null;
  categories: string[];
  explicit: boolean;
  episodes: ParsedEpisode[];
};

export class FeedParseError extends Error {}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep values as strings: a show titled "1984" must not become a number.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'category', 'itunes:category', 'podcast:transcript'].includes(name),
});

/** Text content of an element that may be a string, a CDATA/attribute object, or missing. */
function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'object') return text((value as Node)['#text']);
  return null;
}

function attr(value: unknown, name: string): string | null {
  if (value == null || typeof value !== 'object') return null;
  const node = Array.isArray(value) ? value[0] : value;
  return text((node as Node)?.[`@_${name}`]);
}

function int(value: string | null): number | null {
  if (value == null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** itunes:duration is either seconds ("3600") or a clock ("1:00:00", "59:30"). */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(':').map((p) => Number(p));
  if (parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((total, p) => total * 60 + p, 0);
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function categories(channel: Node): string[] {
  const names = new Set<string>();
  const visit = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const name = attr(node, 'text');
      if (name) names.add(name);
      if (node && typeof node === 'object') visit((node as Node)['itunes:category']);
    }
  };
  visit(channel['itunes:category']);
  return [...names];
}

function parseItem(item: Node, channelArtwork: string | null): ParsedEpisode | null {
  const enclosureUrl = httpUrl(attr(item.enclosure, 'url'));
  if (!enclosureUrl) return null;

  const transcripts = Array.isArray(item['podcast:transcript']) ? item['podcast:transcript'] : [];
  return {
    guid: text(item.guid) ?? enclosureUrl,
    title: text(item.title) ?? 'Untitled episode',
    publishedAt: isoDate(text(item.pubDate)),
    durationSec: parseDuration(text(item['itunes:duration'])),
    enclosureUrl,
    enclosureType: attr(item.enclosure, 'type'),
    enclosureBytes: int(attr(item.enclosure, 'length')) || null,
    showNotesHtml: text(item['content:encoded']) ?? text(item.description),
    artworkUrl: httpUrl(attr(item['itunes:image'], 'href')) ?? channelArtwork,
    season: int(text(item['itunes:season'])),
    episodeNumber: int(text(item['itunes:episode'])),
    transcriptUrl: httpUrl(transcripts.map((t) => attr(t, 'url')).find(Boolean) ?? null),
    chaptersUrl: httpUrl(attr(item['podcast:chapters'], 'url')),
  };
}

export function parseFeed(xml: string): ParsedFeed {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (err) {
    throw new FeedParseError(`Not valid XML: ${(err as Error).message}`);
  }

  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
  if (!channel || typeof channel !== 'object') {
    throw new FeedParseError('Not an RSS feed: missing <rss><channel>');
  }

  const artworkUrl =
    httpUrl(attr(channel['itunes:image'], 'href')) ??
    httpUrl(text((channel.image as Node | undefined)?.url));
  const items = Array.isArray(channel.item) ? (channel.item as Node[]) : [];

  // Feeds sometimes repeat an item; keep the first occurrence of each guid.
  const seen = new Set<string>();
  const episodes: ParsedEpisode[] = [];
  for (const item of items) {
    const episode = parseItem(item, artworkUrl);
    if (episode && !seen.has(episode.guid)) {
      seen.add(episode.guid);
      episodes.push(episode);
    }
  }

  const explicit = text(channel['itunes:explicit'])?.toLowerCase();
  return {
    title: text(channel.title) ?? 'Untitled podcast',
    author: text(channel['itunes:author']) ?? text(channel.author),
    description: text(channel['itunes:summary']) ?? text(channel.description),
    artworkUrl,
    language: text(channel.language),
    categories: categories(channel),
    explicit: explicit === 'true' || explicit === 'yes',
    episodes,
  };
}
