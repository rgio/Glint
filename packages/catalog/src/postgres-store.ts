import type { Episode, Podcast } from '@podcast/shared';
import type { Sql } from 'postgres';

import type { CatalogStore, DueFeed, FeedCacheInfo } from './store';

// Postgres caps a statement at 65,535 parameters; 14 columns per episode keeps a batch well under.
const EPISODE_BATCH = 1000;

type PodcastRow = {
  id: string;
  feed_url: string;
  title: string;
  author: string | null;
  description: string | null;
  artwork_url: string | null;
  language: string | null;
  categories: string[];
  explicit: boolean;
  last_published_at: Date | null;
};

type EpisodeRow = {
  id: string;
  podcast_id: string;
  guid: string;
  title: string;
  published_at: Date | null;
  duration_sec: number | null;
  enclosure_url: string;
  enclosure_type: string | null;
  enclosure_bytes: string | null; // bigint comes back as a string
  show_notes_html: string | null;
  artwork_url: string | null;
  season: number | null;
  episode_number: number | null;
};

const toPodcast = (r: PodcastRow): Podcast => ({
  id: r.id,
  feedUrl: r.feed_url,
  title: r.title,
  author: r.author,
  description: r.description,
  artworkUrl: r.artwork_url,
  language: r.language,
  categories: r.categories,
  explicit: r.explicit,
  lastPublishedAt: r.last_published_at?.toISOString() ?? null,
});

const toEpisode = (r: EpisodeRow): Episode => ({
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
});

const EPISODE_COLUMNS = `id, podcast_id, guid, title, published_at, duration_sec, enclosure_url, enclosure_type,
  enclosure_bytes, show_notes_html, artwork_url, season, episode_number`;

const PODCAST_COLUMNS = `id, feed_url, title, author, description, artwork_url, language, categories, explicit,
  last_published_at`;

export class PostgresCatalogStore implements CatalogStore {
  constructor(private sql: Sql) {}

  async findPodcastById(id: string) {
    const [row] = await this.sql<PodcastRow[]>`
      select ${this.sql.unsafe(PODCAST_COLUMNS)} from podcasts where id = ${id}`;
    return row ? toPodcast(row) : null;
  }

  async findPodcastByFeedUrl(feedUrl: string) {
    const [row] = await this.sql<PodcastRow[]>`
      select ${this.sql.unsafe(PODCAST_COLUMNS)} from podcasts where feed_url = ${feedUrl}`;
    return row ? toPodcast(row) : null;
  }

  async upsertPodcast(p: Podcast, cache: FeedCacheInfo) {
    await this.sql`
      insert into podcasts (id, feed_url, title, author, description, artwork_url, language, categories,
        explicit, last_published_at, feed_etag, feed_last_modified, feed_fetched_at)
      values (${p.id}, ${p.feedUrl}, ${p.title}, ${p.author}, ${p.description}, ${p.artworkUrl}, ${p.language},
        ${this.sql.array(p.categories)}, ${p.explicit}, ${p.lastPublishedAt}, ${cache.etag}, ${cache.lastModified},
        ${cache.fetchedAt})
      on conflict (id) do update set
        feed_url = excluded.feed_url, title = excluded.title, author = excluded.author,
        description = excluded.description, artwork_url = excluded.artwork_url, language = excluded.language,
        categories = excluded.categories, explicit = excluded.explicit,
        last_published_at = excluded.last_published_at, feed_etag = excluded.feed_etag,
        feed_last_modified = excluded.feed_last_modified, feed_fetched_at = excluded.feed_fetched_at,
        updated_at = now()`;
  }

  async getFeedCache(podcastId: string) {
    const [row] = await this.sql<
      { feed_etag: string | null; feed_last_modified: string | null; feed_fetched_at: Date | null }[]
    >`select feed_etag, feed_last_modified, feed_fetched_at from podcasts where id = ${podcastId}`;
    return row
      ? {
          etag: row.feed_etag,
          lastModified: row.feed_last_modified,
          fetchedAt: row.feed_fetched_at?.toISOString() ?? null,
        }
      : null;
  }

  async findEpisodeById(id: string) {
    const [row] = await this.sql<EpisodeRow[]>`
      select ${this.sql.unsafe(EPISODE_COLUMNS)} from episodes where id = ${id}`;
    return row ? toEpisode(row) : null;
  }

  async upsertEpisodes(episodes: Episode[]) {
    for (let i = 0; i < episodes.length; i += EPISODE_BATCH) {
      const rows = episodes.slice(i, i + EPISODE_BATCH).map((e) => ({
        id: e.id,
        podcast_id: e.podcastId,
        guid: e.guid,
        title: e.title,
        published_at: e.publishedAt,
        duration_sec: e.durationSec,
        enclosure_url: e.enclosureUrl,
        enclosure_type: e.enclosureType,
        enclosure_bytes: e.enclosureBytes,
        show_notes_html: e.showNotesHtml,
        artwork_url: e.artworkUrl,
        season: e.season,
        episode_number: e.episodeNumber,
      }));
      await this.sql`
        insert into episodes ${this.sql(rows)}
        on conflict (id) do update set
          podcast_id = excluded.podcast_id, guid = excluded.guid, title = excluded.title,
          published_at = excluded.published_at, duration_sec = excluded.duration_sec,
          enclosure_url = excluded.enclosure_url, enclosure_type = excluded.enclosure_type,
          enclosure_bytes = excluded.enclosure_bytes, show_notes_html = excluded.show_notes_html,
          artwork_url = excluded.artwork_url, season = excluded.season,
          episode_number = excluded.episode_number, updated_at = now()`;
    }
  }

  async listEpisodes(
    podcastId: string,
    { offset, limit, sort }: { offset: number; limit: number; sort: 'newest' | 'oldest' },
  ) {
    // Undated episodes go last when newest-first and first when oldest-first; id (byte order,
    // matching the in-memory store) breaks ties so paging is stable.
    const order =
      sort === 'newest'
        ? this.sql`published_at desc nulls last, id collate "C"`
        : this.sql`published_at asc nulls first, id collate "C"`;
    const rows = await this.sql<EpisodeRow[]>`
      select ${this.sql.unsafe(EPISODE_COLUMNS)}
      from episodes where podcast_id = ${podcastId}
      order by ${order} limit ${limit} offset ${offset}`;
    return rows.map(toEpisode);
  }

  async claimDueFeeds({ now, leaseUntil, limit }: { now: string; leaseUntil: string; limit: number }) {
    // `skip locked` lets concurrent workers claim disjoint batches without waiting on each other.
    const rows = await this.sql<{ id: string; feed_url: string; poll_failures: number }[]>`
      update podcasts set next_poll_at = ${leaseUntil}
      where id in (
        select id from podcasts
        where next_poll_at is null or next_poll_at <= ${now}
        order by next_poll_at nulls first, id collate "C"
        limit ${limit}
        for update skip locked
      )
      returning id, feed_url, poll_failures`;
    return rows
      .map((r): DueFeed => ({ id: r.id, feedUrl: r.feed_url, pollFailures: r.poll_failures }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async recordPoll(podcastId: string, { nextPollAt, failures }: { nextPollAt: string; failures: number }) {
    await this.sql`
      update podcasts set next_poll_at = ${nextPollAt}, poll_failures = ${failures} where id = ${podcastId}`;
  }
}
