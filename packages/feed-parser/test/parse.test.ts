import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FeedParseError, parseDuration, parseFeed } from '../src';

const sample = readFileSync(new URL('./fixtures/sample.xml', import.meta.url), 'utf8');

describe('parseFeed', () => {
  const feed = parseFeed(sample);

  it('reads channel metadata', () => {
    expect(feed).toMatchObject({
      title: '1984',
      author: 'Jane Host',
      description: 'A show about <b>books</b>.',
      artworkUrl: 'https://example.com/show.jpg',
      language: 'en-us',
      categories: ['Arts', 'Books', 'Education'],
      explicit: true,
    });
  });

  it('skips items without audio and duplicate guids', () => {
    expect(feed.episodes.map((e) => e.guid)).toEqual(['ep-2', 'https://cdn.example.com/ep1.mp3']);
  });

  it('reads episode fields', () => {
    expect(feed.episodes[0]).toEqual({
      guid: 'ep-2',
      title: 'Episode two',
      publishedAt: '2026-09-15T08:00:00.000Z',
      durationSec: 3723,
      enclosureUrl: 'https://cdn.example.com/ep2.mp3',
      enclosureType: 'audio/mpeg',
      enclosureBytes: 123456,
      showNotesHtml: '<p>Notes with <a href="https://example.com">a link</a> at 12:30.</p>',
      artworkUrl: 'https://example.com/ep2.jpg',
      season: 1,
      episodeNumber: 2,
      transcriptUrl: 'https://example.com/ep2.vtt',
      chaptersUrl: 'https://example.com/ep2.json',
    });
  });

  it('falls back leniently on bad or missing values', () => {
    expect(feed.episodes[1]).toMatchObject({
      publishedAt: null,
      durationSec: 3600,
      enclosureBytes: null,
      showNotesHtml: 'First one',
      artworkUrl: 'https://example.com/show.jpg',
    });
  });

  it('rejects documents that are not RSS', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(FeedParseError);
  });
});

describe('parseDuration', () => {
  it.each([
    ['59:30', 3570],
    ['1:00:00', 3600],
    ['45', 45],
    ['abc', null],
    ['', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});
