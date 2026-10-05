import { WEB_URL } from './ports';

/** Builds the web bundle once before the tests, so the first test doesn't time out waiting for it. */
export default async function warmUp() {
  const html = await (await fetch(WEB_URL)).text();
  const src = /<script src="([^"]+)"/.exec(html)?.[1];
  if (!src) throw new Error('No script tag in the web app');
  const res = await fetch(new URL(src.replace(/&amp;/g, '&'), WEB_URL), { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Web bundle failed to build: HTTP ${res.status}`);
  await res.text();
}
