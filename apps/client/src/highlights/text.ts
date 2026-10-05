import type { Highlight } from '@podcast/shared';

// Relative, not '@/', so vitest can load this module.
import { formatClock } from '../lib/format';

type EpisodeInfo = { title: string; podcastTitle: string };

/** "12:04–12:34". */
export const rangeLabel = (h: Pick<Highlight, 'startSec' | 'endSec'>) => `${formatClock(h.startSec)}–${formatClock(h.endSec)}`;

/** What "Share quote" sends: the note (when there is one), where it's from, and when. */
export function quoteText(h: Highlight, episode: EpisodeInfo): string {
  const source = `${episode.title}, ${episode.podcastTitle} (${rangeLabel(h)})`;
  const words = h.transcriptExcerpt ?? h.note;
  return words ? `“${words}” — ${source}` : source;
}

/**
 * All highlights as Markdown: a section per show, a subsection per episode (newest highlight
 * first), and each highlight's time range, note and transcript excerpt.
 */
export function highlightsMarkdown(highlights: Highlight[], episodes: Record<string, EpisodeInfo>, exportedAt: Date): string {
  const live = highlights.filter((h) => !h.deleted);
  const byEpisode = new Map<string, Highlight[]>();
  for (const h of live) byEpisode.set(h.episodeId, [...(byEpisode.get(h.episodeId) ?? []), h]);

  const latest = (id: string) => Math.max(...byEpisode.get(id)!.map((h) => h.createdAt));
  const byShow = new Map<string, string[]>();
  for (const id of [...byEpisode.keys()].sort((a, b) => latest(b) - latest(a))) {
    const show = episodes[id]?.podcastTitle ?? 'Unknown show';
    byShow.set(show, [...(byShow.get(show) ?? []), id]);
  }

  const lines = ['# Podcast highlights', '', `Exported ${exportedAt.toISOString().slice(0, 10)}.`];
  for (const [show, ids] of byShow) {
    lines.push('', `## ${show}`);
    for (const id of ids) {
      lines.push('', `### ${episodes[id]?.title ?? 'Unknown episode'}`, '');
      for (const h of byEpisode.get(id)!.sort((a, b) => a.startSec - b.startSec)) {
        const note = h.note ? h.note.replace(/\n/g, '\n  ') : '_No note_';
        lines.push(`- **${rangeLabel(h)}** ${note}`);
        if (h.transcriptExcerpt) lines.push(`  > ${h.transcriptExcerpt}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
