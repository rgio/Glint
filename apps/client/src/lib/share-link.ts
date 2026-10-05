import { API_URL } from '@/api/client';

/** Where share links point. The API serves them today; a custom domain can take over later. */
const SHARE_URL = (process.env.EXPO_PUBLIC_SHARE_URL ?? API_URL).replace(/\/$/, '');

/** F-15: the public link for an episode. It previews in chat apps and opens the episode's web page. */
export const episodeShareUrl = (episodeId: string) => `${SHARE_URL}/s/e/${encodeURIComponent(episodeId)}`;

export type ShareOutcome = 'shared' | 'copied' | 'cancelled';
