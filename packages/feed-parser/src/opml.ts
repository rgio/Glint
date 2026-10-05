import { XMLParser } from 'fast-xml-parser';

/** F-03: OPML is how podcast apps move a list of subscriptions between each other. */
export type OpmlFeed = { title: string | null; feedUrl: string };

export class OpmlParseError extends Error {}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'outline',
});

/** Attribute values by name, ignoring case: apps write xmlUrl, xmlurl and XMLURL. */
function attribute(node: Node, name: string): string | null {
  const wanted = `@_${name}`.toLowerCase();
  for (const [key, value] of Object.entries(node)) {
    if (key.toLowerCase() === wanted && typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Feed URLs we can fetch: http(s), with feed:// read as https. */
function feedUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.replace(/^feed:\/\//i, 'https://'));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Reads the feeds out of an OPML file. Outlines can be nested in folders; every outline with
 * a feed URL counts. Duplicates are dropped, and outlines with unusable URLs are counted in
 * `skipped`.
 */
export function parseOpml(xml: string): { title: string | null; feeds: OpmlFeed[]; skipped: number } {
  let doc: Node;
  try {
    doc = parser.parse(xml, true) as Node;
  } catch (err) {
    throw new OpmlParseError(`Not a valid OPML file: ${(err as Error).message}`);
  }
  const opml = doc.opml as Node | undefined;
  const body = opml?.body as Node | undefined;
  if (!opml || body === undefined) throw new OpmlParseError('Not an OPML file: no <opml> or <body>.');

  const head = opml.head as Node | undefined;
  const headTitle = head?.title;
  const title = typeof headTitle === 'string' && headTitle ? headTitle : null;

  const feeds: OpmlFeed[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const walk = (outlines: unknown) => {
    if (!Array.isArray(outlines)) return;
    for (const outline of outlines as Node[]) {
      const raw = attribute(outline, 'xmlUrl');
      if (raw) {
        const url = feedUrl(raw);
        if (!url) skipped++;
        else if (!seen.has(url)) {
          seen.add(url);
          feeds.push({ title: attribute(outline, 'title') ?? attribute(outline, 'text'), feedUrl: url });
        }
      }
      walk(outline.outline);
    }
  };
  walk(body && typeof body === 'object' ? (body as Node).outline : undefined);

  return { title, feeds, skipped };
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Writes an OPML 2.0 file of subscriptions, one `type="rss"` outline per feed. */
export function buildOpml({
  title,
  feeds,
  dateCreated,
}: {
  title: string;
  feeds: { title: string; feedUrl: string }[];
  dateCreated: Date;
}): string {
  const outlines = feeds
    .map(
      (f) =>
        `    <outline type="rss" text="${escape(f.title)}" title="${escape(f.title)}" xmlUrl="${escape(f.feedUrl)}"/>`,
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escape(title)}</title>`,
    `    <dateCreated>${dateCreated.toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...(outlines ? [outlines] : []),
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}
