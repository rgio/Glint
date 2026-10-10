import type { Episode, Podcast } from '@podcast/shared';
import type { Sql } from 'postgres';

// Catalog-wide questions the content worker asks, beyond CatalogStore's per-show lookups.

export type EpisodeWithPodcast = { episode: Episode; podcast: Podcast };

export interface CatalogQueries {
  episode(id: string): Promise<EpisodeWithPodcast | null>;
  episodes(ids: string[]): Promise<EpisodeWithPodcast[]>;
  /** Episodes without a description vector for this model, newest first. */
  episodesMissingVector(model: string, limit: number): Promise<EpisodeWithPodcast[]>;
  /**
   * Episodes worth asking dLogos about for the discovery corpus: shows with a dLogos slug, most
   * subscribed and most highlighted first, newest episodes first, no transcript row yet.
   */
  seedCandidates(limit: number): Promise<{ episodeId: string; podcastId: string }[]>;
  /**
   * Whether an episode's transcript windows are worth embedding (the "partial" rule): someone
   * highlighted it, or someone subscribes to its show.
   */
  windowsWanted(episodeId: string): Promise<boolean>;
}

/** Plain text from show notes HTML: enough for embedding, not for display. */
export function notesText(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** What an episode's description vector is made from. */
export const episodeText = ({ episode, podcast }: EpisodeWithPodcast) =>
  `${episode.title}\n${podcast.title}\n${notesText(episode.showNotesHtml)}`.slice(0, 8000);

type Joined = {
  id: string;
  podcast_id: string;
  guid: string;
  title: string;
  published_at: Date | null;
  duration_sec: number | null;
  enclosure_url: string;
  enclosure_type: string | null;
  enclosure_bytes: string | null;
  show_notes_html: string | null;
  artwork_url: string | null;
  season: number | null;
  episode_number: number | null;
  transcript_url: string | null;
  transcript_type: string | null;
  chapters_url: string | null;
  p_feed_url: string;
  p_title: string;
  p_author: string | null;
  p_description: string | null;
  p_artwork_url: string | null;
  p_language: string | null;
  p_categories: string[];
  p_explicit: boolean;
  p_last_published_at: Date | null;
};

const JOINED = `e.id, e.podcast_id, e.guid, e.title, e.published_at, e.duration_sec, e.enclosure_url, e.enclosure_type,
  e.enclosure_bytes, e.show_notes_html, e.artwork_url, e.season, e.episode_number, e.transcript_url, e.transcript_type,
  e.chapters_url, p.feed_url as p_feed_url, p.title as p_title, p.author as p_author, p.description as p_description,
  p.artwork_url as p_artwork_url, p.language as p_language, p.categories as p_categories, p.explicit as p_explicit,
  p.last_published_at as p_last_published_at`;

const toJoined = (r: Joined): EpisodeWithPodcast => ({
  episode: {
    id: r.id,
    podcastId: r.podcast_id,
    guid: r.guid,
    title: r.title,
    publishedAt: r.published_at?.toISOString() ?? null,
    durationSec: r.duration_sec,
    enclosureUrl: r.enclosure_url,
    enclosureType: r.enclosure_type,
    enclosureBytes: r.enclosure_bytes === null ? null : Number(r.enclosure_bytes),
    showNotesHtml: r.show_notes_html,
    artworkUrl: r.artwork_url,
    season: r.season,
    episodeNumber: r.episode_number,
    transcriptUrl: r.transcript_url,
    transcriptType: r.transcript_type,
    chaptersUrl: r.chapters_url,
  },
  podcast: {
    id: r.podcast_id,
    feedUrl: r.p_feed_url,
    title: r.p_title,
    author: r.p_author,
    description: r.p_description,
    artworkUrl: r.p_artwork_url,
    language: r.p_language,
    categories: r.p_categories,
    explicit: r.p_explicit,
    lastPublishedAt: r.p_last_published_at?.toISOString() ?? null,
  },
});

export class PostgresCatalogQueries implements CatalogQueries {
  constructor(private sql: Sql) {}

  async episode(id: string) {
    const [r] = await this.sql<Joined[]>`
      select ${this.sql.unsafe(JOINED)} from episodes e join podcasts p on p.id = e.podcast_id where e.id = ${id}`;
    return r ? toJoined(r) : null;
  }

  async episodes(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.sql<Joined[]>`
      select ${this.sql.unsafe(JOINED)} from episodes e join podcasts p on p.id = e.podcast_id where e.id = any(${ids})`;
    return rows.map(toJoined);
  }

  async episodesMissingVector(model: string, limit: number) {
    const rows = await this.sql<Joined[]>`
      select ${this.sql.unsafe(JOINED)} from episodes e join podcasts p on p.id = e.podcast_id
      where not exists (
        select 1 from embeddings v where v.owner_kind = 'episode' and v.owner_id = e.id and v.model = ${model})
      order by e.published_at desc nulls last, e.id
      limit ${limit}`;
    return rows.map(toJoined);
  }

  async seedCandidates(limit: number) {
    const rows = await this.sql<{ episode_id: string; podcast_id: string }[]>`
      with demand as (
        select d.podcast_id,
          (select count(*) from user_subscriptions s where s.podcast_id = d.podcast_id and not s.deleted)
          + (select count(*) from highlights h where h.podcast_id = d.podcast_id and not h.deleted) as score
        from dlogos_podcasts d
      )
      select e.id as episode_id, e.podcast_id
      from demand join lateral (
        select id, podcast_id from episodes e
        where e.podcast_id = demand.podcast_id
          and not exists (select 1 from transcripts t where t.episode_id = e.id)
        order by e.published_at desc nulls last
        limit 5
      ) e on true
      order by demand.score desc, e.id
      limit ${limit}`;
    return rows.map((r) => ({ episodeId: r.episode_id, podcastId: r.podcast_id }));
  }

  async windowsWanted(episodeId: string) {
    const [r] = await this.sql<{ wanted: boolean }[]>`
      select exists (select 1 from highlights where episode_id = ${episodeId} and not deleted)
        or exists (
          select 1 from user_subscriptions s join episodes e on e.podcast_id = s.podcast_id
          where e.id = ${episodeId} and not s.deleted) as wanted`;
    return r?.wanted ?? false;
  }
}

/** For tests: a fixed catalog, with vectors and demand checked through callbacks. */
export class InMemoryCatalogQueries implements CatalogQueries {
  constructor(
    private items: EpisodeWithPodcast[],
    private hooks: {
      hasVector?: (episodeId: string, model: string) => Promise<boolean>;
      windowsWanted?: (episodeId: string) => boolean;
      seed?: () => { episodeId: string; podcastId: string }[];
    } = {},
  ) {}

  async episode(id: string) {
    return this.items.find((i) => i.episode.id === id) ?? null;
  }

  async episodes(ids: string[]) {
    return this.items.filter((i) => ids.includes(i.episode.id));
  }

  async episodesMissingVector(model: string, limit: number) {
    const out: EpisodeWithPodcast[] = [];
    for (const i of this.items) {
      if (out.length >= limit) break;
      if (!(await this.hooks.hasVector?.(i.episode.id, model))) out.push(i);
    }
    return out;
  }

  async seedCandidates(limit: number) {
    return (this.hooks.seed?.() ?? []).slice(0, limit);
  }

  async windowsWanted(episodeId: string) {
    return this.hooks.windowsWanted?.(episodeId) ?? false;
  }
}
