import type { Episode, Highlight, Podcast } from './models';

// Transcripts, highlight search and recommendations: the content layer's API shapes.

/** Where an episode's transcript came from. dLogos is preferred; publisher transcripts are the fallback. */
export type TranscriptSource = 'dlogos' | 'publisher_json' | 'publisher_vtt' | 'publisher_srt';

/**
 * `ready`: words available. `pending`: requested and being processed. `unavailable`: no source has
 * one (retried later). `none`: nobody has asked for this episode's transcript yet.
 */
export type TranscriptStatus = 'ready' | 'pending' | 'unavailable' | 'none';

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
};

export type TranscriptChapter = { startMs: number; title: string };

/** `GET /v1/episodes/:id/transcript/status` */
export type TranscriptStatusResponse = { status: TranscriptStatus; source: TranscriptSource | null };

/** `GET /v1/episodes/:id/transcript?start=&end=` (seconds; both optional). */
export type TranscriptRangeResponse = {
  status: TranscriptStatus;
  source: TranscriptSource | null;
  segments: TranscriptSegment[];
  chapters: TranscriptChapter[];
};

/** `GET /v1/me/highlights?q=&cursor=` */
export type HighlightSearchResponse = {
  highlights: Highlight[];
  nextCursor: string | null;
  podcasts: Podcast[];
  episodes: Episode[];
};

/** One recommended episode, with the highlight that led to it. */
export type Recommendation = {
  episode: Episode;
  podcast: Podcast;
  score: number;
  /** Where in the episode the match is, when it matched a moment rather than the whole episode. */
  startSec: number | null;
  because: { highlightId: string; text: string; episodeTitle: string | null } | null;
};

/** `GET /v1/me/recommendations` */
export type RecommendationsResponse = { recommendations: Recommendation[]; generatedAt: string | null };
