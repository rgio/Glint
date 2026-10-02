import { z } from 'zod';

// Catalog entities: global, read-only to clients.

export const Podcast = z.object({
  id: z.string(),
  feedUrl: z.url(),
  title: z.string(),
  author: z.string().nullable(),
  description: z.string().nullable(),
  artworkUrl: z.url().nullable(),
  language: z.string().nullable(),
  categories: z.array(z.string()),
  explicit: z.boolean(),
  lastPublishedAt: z.iso.datetime().nullable(),
});
export type Podcast = z.infer<typeof Podcast>;

export const Episode = z.object({
  id: z.string(),
  podcastId: z.string(),
  guid: z.string(),
  title: z.string(),
  publishedAt: z.iso.datetime().nullable(),
  durationSec: z.number().nonnegative().nullable(),
  enclosureUrl: z.url(),
  enclosureType: z.string().nullable(),
  enclosureBytes: z.number().int().nonnegative().nullable(),
  showNotesHtml: z.string().nullable(),
  artworkUrl: z.url().nullable(),
  season: z.number().int().nullable(),
  episodeNumber: z.number().int().nullable(),
});
export type Episode = z.infer<typeof Episode>;

// Directory entries: shows found through search or charts (F-01, F-02). They
// may not be in our catalog yet; resolving the feed URL adds them.

export const DirectoryPodcast = z.object({
  feedUrl: z.url(),
  title: z.string(),
  author: z.string().nullable(),
  description: z.string().nullable(),
  artworkUrl: z.url().nullable(),
  categories: z.array(z.string()),
  language: z.string().nullable(),
});
export type DirectoryPodcast = z.infer<typeof DirectoryPodcast>;

export const Category = z.object({ id: z.number().int(), name: z.string() });
export type Category = z.infer<typeof Category>;

// Per-user state: synced across devices. `updatedAt` is the client clock in
// epoch milliseconds when the change was made.

export const Subscription = z.object({
  podcastId: z.string(),
  subscribedAt: z.number().int(),
  autoDownload: z.boolean(),
  updatedAt: z.number().int(),
  deleted: z.boolean().default(false),
});
export type Subscription = z.infer<typeof Subscription>;

export const EpisodeState = z.object({
  episodeId: z.string(),
  positionSec: z.number().nonnegative(),
  played: z.boolean(),
  updatedAt: z.number().int(),
});
export type EpisodeState = z.infer<typeof EpisodeState>;

export const QueueItem = z.object({
  episodeId: z.string(),
  sortKey: z.string().min(1),
  updatedAt: z.number().int(),
  deleted: z.boolean().default(false),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const Settings = z.object({
  skipBackSec: z.union([z.literal(10), z.literal(15), z.literal(30)]),
  skipForwardSec: z.union([z.literal(10), z.literal(15), z.literal(30)]),
  playbackRate: z.number().min(0.5).max(3),
  wifiOnlyDownloads: z.boolean(),
  autoDeletePlayed: z.boolean(),
  updatedAt: z.number().int(),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  skipBackSec: 15,
  skipForwardSec: 30,
  playbackRate: 1,
  wifiOnlyDownloads: true,
  autoDeletePlayed: true,
  updatedAt: 0,
};

// API request bodies.

export const ResolveFeedRequest = z.object({ feedUrl: z.url() });
export type ResolveFeedRequest = z.infer<typeof ResolveFeedRequest>;
