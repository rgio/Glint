/**
 * The world the end-to-end tests run in: podcast feeds and audio served locally, so tests never
 * depend on real feeds, Podcast Index or the network.
 */

export const AUDIO_SECONDS = 300;
const DAY = 24 * 60 * 60 * 1000;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A silent mono WAV: 8 kHz, 8-bit, so five minutes is 2.4 MB. Browsers play and seek it. */
export function silentWav(seconds = AUDIO_SECONDS): Buffer {
  const rate = 8000;
  const data = rate * seconds;
  const wav = Buffer.alloc(44 + data, 128); // 128 is silence for unsigned 8-bit PCM
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); // PCM header size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28); // bytes per second
  wav.writeUInt16LE(1, 32); // block align
  wav.writeUInt16LE(8, 34); // bits per sample
  wav.write('data', 36);
  wav.writeUInt32LE(data, 40);
  return wav;
}

export type FixtureEpisode = {
  guid: string;
  title: string;
  daysAgo: number;
  notes: string;
  season?: number;
  episode?: number;
};

export type FixtureShow = { slug: string; title: string; author: string; description: string; episodes: FixtureEpisode[] };

export const SHOWS: FixtureShow[] = [
  {
    slug: 'daily',
    title: 'Fixture Daily',
    author: 'Fixture Media',
    description: 'A show that publishes every day.',
    episodes: Array.from({ length: 6 }, (_, i) => ({
      guid: `daily-${i}`,
      title: `Daily episode ${6 - i}`,
      daysAgo: i,
      notes:
        i === 0
          ? '<p>(0:00) Intro<br>(1:30) The main topic<br>(4:00) Wrap-up</p>' +
            '<p>More at <a href="https://example.com/notes">example.com</a>.</p><script>window.__notesScriptRan = true</script>'
          : `<p>Notes for daily episode ${6 - i}.</p>`,
    })),
  },
  {
    slug: 'seasons',
    title: 'Fixture Seasons',
    author: 'Fixture Media',
    description: 'A show told in seasons.',
    episodes: [1, 2].flatMap((season) =>
      [1, 2, 3].map((n) => ({
        guid: `s${season}e${n}`,
        title: `Season ${season}, episode ${n}`,
        daysAgo: 60 - (season - 1) * 21 - n * 7,
        notes: `<p>S${season}E${n}.</p>`,
        season,
        episode: n,
      })),
    ),
  },
  {
    slug: 'weekly',
    title: 'Fixture Weekly',
    author: 'Weekly Co',
    description: 'A show that publishes every week.',
    episodes: Array.from({ length: 3 }, (_, i) => ({
      guid: `weekly-${i}`,
      title: `Weekly episode ${3 - i}`,
      daysAgo: 3 + i * 7,
      notes: `<p>Notes for weekly episode ${3 - i}.</p>`,
    })),
  },
];

/** The RSS for a show, with publish dates relative to `now` so "new episodes" stay new. */
export function feedXml(show: FixtureShow, base: string, now = Date.now()): string {
  const items = show.episodes
    .map(
      (e) => `
    <item>
      <title>${escape(e.title)}</title>
      <guid isPermaLink="false">${e.guid}</guid>
      <pubDate>${new Date(now - e.daysAgo * DAY - 60 * 60 * 1000).toUTCString()}</pubDate>
      <itunes:duration>${AUDIO_SECONDS}</itunes:duration>
      ${e.season ? `<itunes:season>${e.season}</itunes:season><itunes:episode>${e.episode}</itunes:episode>` : ''}
      <description><![CDATA[${e.notes}]]></description>
      <enclosure url="${base}/audio.wav?ep=${e.guid}" type="audio/wav" length="${44 + 8000 * AUDIO_SECONDS}"/>
    </item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escape(show.title)}</title>
    <itunes:author>${escape(show.author)}</itunes:author>
    <description>${escape(show.description)}</description>
    <language>en</language>${items}
  </channel>
</rss>`;
}
