import { describe, expect, it } from 'vitest';

import { buildOpml, OpmlParseError, parseOpml } from '../src/opml';

describe('parseOpml', () => {
  it('reads feeds, including ones nested in folders, in document order', () => {
    const xml = `<?xml version="1.0"?>
      <opml version="2.0">
        <head><title>My shows</title></head>
        <body>
          <outline text="Planet Money" type="rss" xmlUrl="https://feeds.npr.org/510289/podcast.xml"/>
          <outline text="Tech">
            <outline title="The Vergecast" text="Vergecast" xmlUrl="https://feeds.megaphone.fm/vergecast"/>
            <outline text="Deeper">
              <outline text="Podnews" xmlUrl="https://podnews.net/rss"/>
            </outline>
          </outline>
        </body>
      </opml>`;
    expect(parseOpml(xml)).toEqual({
      title: 'My shows',
      feeds: [
        { title: 'Planet Money', feedUrl: 'https://feeds.npr.org/510289/podcast.xml' },
        { title: 'The Vergecast', feedUrl: 'https://feeds.megaphone.fm/vergecast' },
        { title: 'Podnews', feedUrl: 'https://podnews.net/rss' },
      ],
      skipped: 0,
    });
  });

  it('accepts any case of xmlUrl, upgrades feed://, and decodes entities', () => {
    const xml = `<opml><body>
      <outline text="A &amp; B" xmlurl="feed://example.com/a.xml"/>
      <outline text="C" XMLURL="https://example.com/c.xml?x=1&amp;y=2"/>
    </body></opml>`;
    expect(parseOpml(xml).feeds).toEqual([
      { title: 'A & B', feedUrl: 'https://example.com/a.xml' },
      { title: 'C', feedUrl: 'https://example.com/c.xml?x=1&y=2' },
    ]);
  });

  it('drops duplicates and counts unusable URLs', () => {
    const xml = `<opml><body>
      <outline text="One" xmlUrl="https://example.com/1.xml"/>
      <outline text="One again" xmlUrl="https://example.com/1.xml"/>
      <outline text="Local" xmlUrl="file:///Users/me/feed.xml"/>
      <outline text="Junk" xmlUrl="not a url"/>
      <outline text="Folder without a feed"/>
    </body></opml>`;
    const { feeds, skipped } = parseOpml(xml);
    expect(feeds.map((f) => f.title)).toEqual(['One']);
    expect(skipped).toBe(2);
  });

  it('handles an empty body and a missing title', () => {
    expect(parseOpml('<opml version="2.0"><head/><body/></opml>')).toEqual({ title: null, feeds: [], skipped: 0 });
  });

  it('rejects files that are not OPML', () => {
    expect(() => parseOpml('<rss><channel/></rss>')).toThrow(OpmlParseError);
    expect(() => parseOpml('just some text')).toThrow(OpmlParseError);
    expect(() => parseOpml('<opml><body><outline></opml>')).toThrow(OpmlParseError);
  });
});

describe('buildOpml', () => {
  it('writes OPML 2.0 that reads back to the same feeds, escaping special characters', () => {
    const feeds = [
      { title: 'Tom & Jerry\'s "Show" <live>', feedUrl: 'https://example.com/feed?a=1&b=2' },
      { title: 'Plain', feedUrl: 'https://example.com/plain.xml' },
    ];
    const xml = buildOpml({ title: 'Podcast subscriptions', feeds, dateCreated: new Date(Date.UTC(2026, 9, 5, 12)) });

    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain('<dateCreated>Mon, 05 Oct 2026 12:00:00 GMT</dateCreated>');
    expect(xml).toContain('text="Tom &amp; Jerry&apos;s &quot;Show&quot; &lt;live&gt;"');
    expect(parseOpml(xml)).toEqual({ title: 'Podcast subscriptions', feeds, skipped: 0 });
  });

  it('writes a valid file with no feeds', () => {
    const xml = buildOpml({ title: 'Empty', feeds: [], dateCreated: new Date(0) });
    expect(parseOpml(xml)).toEqual({ title: 'Empty', feeds: [], skipped: 0 });
  });
});
