import type { Highlight } from '@podcast/shared';
import { describe, expect, it } from 'vitest';

import { highlightsMarkdown, quoteText, rangeLabel } from './text';

const h = (id: string, episodeId: string, startSec: number, createdAt: number, note: string | null = null): Highlight => ({
  id,
  episodeId,
  podcastId: 'pod',
  startSec,
  endSec: startSec + 30,
  note,
  transcriptExcerpt: null,
  chapterTitle: null,
  anchorDurationSec: 3600,
  anchorEnclosureUrl: null,
  source: 'player',
  createdAt,
  rangeUpdatedAt: createdAt,
  noteUpdatedAt: createdAt,
  deleted: false,
});

const episodes = {
  e1: { title: 'Older episode', podcastTitle: 'Show A' },
  e2: { title: 'Newer episode', podcastTitle: 'Show A' },
  e3: { title: 'Other show episode', podcastTitle: 'Show B' },
};

describe('highlight text', () => {
  it('labels ranges and builds quotes with or without a note', () => {
    expect(rangeLabel({ startSec: 724, endSec: 754 })).toBe('12:04–12:34');
    expect(quoteText(h('1', 'e1', 724, 1, 'Great point'), episodes.e1)).toBe('“Great point” — Older episode, Show A (12:04–12:34)');
    expect(quoteText(h('1', 'e1', 724, 1), episodes.e1)).toBe('Older episode, Show A (12:04–12:34)');
  });

  it('exports Markdown grouped by show and episode, newest first, skipping deleted ones', () => {
    const md = highlightsMarkdown(
      [
        h('1', 'e1', 600, 100, 'first\nsecond line'),
        h('2', 'e2', 60, 300),
        h('3', 'e1', 30, 200, 'earlier in the episode'),
        h('4', 'e3', 90, 250),
        { ...h('5', 'e3', 10, 400, 'gone'), deleted: true },
      ],
      episodes,
      new Date(Date.UTC(2026, 9, 5)),
    );
    expect(md).toBe(
      [
        '# Podcast highlights',
        '',
        'Exported 2026-10-05.',
        '',
        '## Show A',
        '',
        '### Newer episode',
        '',
        '- **1:00–1:30** _No note_',
        '',
        '### Older episode',
        '',
        '- **0:30–1:00** earlier in the episode',
        '- **10:00–10:30** first',
        '  second line',
        '',
        '## Show B',
        '',
        '### Other show episode',
        '',
        '- **1:30–2:00** _No note_',
        '',
      ].join('\n'),
    );
  });
});
