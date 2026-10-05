import { buildOpml, parseOpml } from '@podcast/feed-parser';

import { importFeeds, type ImportResult } from './import-feeds';
import { pickOpmlText, saveOpml } from './opml-files';
import { useLibrary } from './store';

import { api } from '@/api/client';

export type OpmlImportOutcome = ImportResult & { found: number; skippedInvalid: number };

/** F-03: saves the listener's subscriptions as an OPML file (download on web, share sheet on phones). */
export async function exportSubscriptions(): Promise<number> {
  const podcasts = Object.values(useLibrary.getState().subscriptions)
    .map((s) => s.podcast)
    .sort((a, b) => a.title.localeCompare(b.title));
  const xml = buildOpml({
    title: 'Podcast subscriptions',
    feeds: podcasts.map((p) => ({ title: p.title, feedUrl: p.feedUrl })),
    dateCreated: new Date(),
  });
  await saveOpml(xml, `podcast-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`);
  return podcasts.length;
}

/**
 * F-03: picks an OPML file and subscribes to every show in it. Resolves to null if the
 * listener cancels the picker; throws if the file isn't OPML.
 */
export async function importOpml(onProgress: (done: number, total: number) => void): Promise<OpmlImportOutcome | null> {
  const text = await pickOpmlText();
  if (text === null) return null;
  const { feeds, skipped } = parseOpml(text);
  const library = useLibrary.getState();
  const result = await importFeeds(feeds, {
    subscribedUrls: Object.values(library.subscriptions).map((s) => s.podcast.feedUrl),
    resolve: async (feedUrl) => (await api.resolvePodcast(feedUrl)).podcast,
    subscribe: (podcast) => useLibrary.getState().subscribe(podcast),
    onProgress,
  });
  return { ...result, found: feeds.length, skippedInvalid: skipped };
}
