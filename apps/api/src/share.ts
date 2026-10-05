import type { Episode, Podcast } from '@podcast/shared';

const DESCRIPTION_LENGTH = 200;

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Show notes as one line of plain text for a preview description. */
export function previewText(html: string | null, max = DESCRIPTION_LENGTH): string {
  if (!html) return '';
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).trimEnd()}…`;
}

/**
 * F-15: the page a shared episode link points at. Chat apps and social sites read its
 * Open Graph tags for the link preview (their crawlers don't run JavaScript, so the tags must
 * be in this HTML); people are sent straight on to the episode page in the web app.
 */
export function renderSharePage({
  episode,
  podcast,
  shareUrl,
  episodeUrl,
}: {
  episode: Episode;
  podcast: Podcast;
  shareUrl: string;
  episodeUrl: string;
}): string {
  const title = `${episode.title} · ${podcast.title}`;
  const description = previewText(episode.showNotesHtml) || previewText(podcast.description);
  const image = episode.artworkUrl ?? podcast.artworkUrl;
  const meta = [
    ['og:type', 'website'],
    ['og:site_name', 'Podcast'],
    ['og:title', episode.title],
    ['og:description', `${podcast.title}${description ? ` · ${description}` : ''}`],
    ['og:url', shareUrl],
    ...(image ? [['og:image', image]] : []),
    ['og:audio', episode.enclosureUrl],
  ]
    .map(([property, content]) => `    <meta property="${property}" content="${escape(content!)}">`)
    // Twitter reads its card type from `name`, not `property`.
    .concat(`    <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}">
    <link rel="canonical" href="${escape(episodeUrl)}">
${meta}
    <meta http-equiv="refresh" content="0; url=${escape(episodeUrl)}">
  </head>
  <body>
    <p><a href="${escape(episodeUrl)}">Listen to ${escape(episode.title)}</a> from ${escape(podcast.title)}.</p>
  </body>
</html>
`;
}

/** Shown for a link to an episode we don't know: still somewhere useful to go. */
export function renderShareNotFound(webUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Episode not found</title>
  </head>
  <body>
    <p>This episode isn't available. <a href="${escape(webUrl)}">Browse podcasts</a>.</p>
  </body>
</html>
`;
}
