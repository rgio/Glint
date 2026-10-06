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

/** The skip intervals the app offers, in seconds. */
export const SKIP_INTERVALS = [10, 15, 30] as const;
export type SkipInterval = (typeof SKIP_INTERVALS)[number];

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

// Highlights: a listener-chosen range of an episode, with an optional note.

/** Where a highlight was captured, for metrics. */
export const HighlightSource = z.enum(['player', 'miniPlayer', 'keyboard', 'headphones', 'lockScreen']);
export type HighlightSource = z.infer<typeof HighlightSource>;

/** Longest highlight, in seconds of audio. */
export const HIGHLIGHT_MAX_SEC = 300;
/** Shortest highlight, in seconds of audio. */
export const HIGHLIGHT_MIN_SEC = 3;
export const HIGHLIGHT_NOTE_MAX = 5000;

export const Highlight = z.object({
  /** Made on the device, so offline captures never collide. */
  id: z.uuid(),
  episodeId: z.string(),
  podcastId: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  note: z.string().max(HIGHLIGHT_NOTE_MAX).nullable(),
  /** The transcript words in the range, once a transcript is available (later phase). */
  transcriptExcerpt: z.string().nullable(),
  chapterTitle: z.string().nullable(),
  /** The episode as it was when captured, for relocating the range if the audio changes. */
  anchorDurationSec: z.number().nonnegative().nullable(),
  anchorEnclosureUrl: z.string().nullable(),
  source: HighlightSource,
  createdAt: z.number().int(),
  /** The range and the note are edited separately, so each keeps its own edit time for merging. */
  rangeUpdatedAt: z.number().int(),
  noteUpdatedAt: z.number().int(),
  deleted: z.boolean().default(false),
});
export type Highlight = z.infer<typeof Highlight>;

// API request bodies.

export const ResolveFeedRequest = z.object({ feedUrl: z.url() });
export type ResolveFeedRequest = z.infer<typeof ResolveFeedRequest>;

// Accounts (F-12): email sign-in with a link (web) or a 6-digit code (phones).

/** Which kind of client is signing in: web keeps the refresh token in an HttpOnly cookie. */
export const ClientKind = z.enum(['web', 'native']);
export type ClientKind = z.infer<typeof ClientKind>;

/** Trimmed and lowercased before checking: phone keyboards add trailing spaces and capitals. */
const EmailAddress = z.string().trim().toLowerCase().pipe(z.email().max(320));

export const EmailSignInStart = z.object({ email: EmailAddress });
export type EmailSignInStart = z.infer<typeof EmailSignInStart>;

export const EmailSignInVerify = z.union([
  z.object({ token: z.string().min(20).max(200), client: ClientKind }),
  z.object({ email: EmailAddress, code: z.string().regex(/^\d{6}$/), client: ClientKind }),
]);
export type EmailSignInVerify = z.infer<typeof EmailSignInVerify>;

export const RefreshRequest = z.object({ client: ClientKind, refreshToken: z.string().optional() });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export type User = { id: string; email: string; createdAt: string };

/** What sign-in and refresh return. Web clients get the refresh token as a cookie instead. */
export type AuthSession = { user: User; accessToken: string; accessTokenExpiresAt: string; refreshToken?: string };
