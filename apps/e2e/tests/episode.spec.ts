import { API_URL } from '../src/ports';

import { episodesOf, expect, resolveShow, test } from './helpers';

test('show notes render safely, and timestamps play from that point', async ({ app, page }) => {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);

  // The title in a list opens the episode page.
  await app.goto(`/podcast/${show.id}`);
  await page.getByLabel(`${latest!.title}. Episode details`).click();
  await expect(page).toHaveURL(new RegExp(`/episode/${latest!.id}$`));

  await expect(page.getByText('Show notes', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'example.com' })).toBeVisible();
  // The <script> in the feed's notes is dropped, not run or shown.
  expect(await page.evaluate(() => (window as unknown as { __notesScriptRan?: boolean }).__notesScriptRan)).toBeUndefined();
  await expect(page.getByText('__notesScriptRan')).toHaveCount(0);

  await page.getByLabel('Play from 1:30').click();
  await app.waitForAudio('!a.paused && a.currentTime >= 90 && a.currentTime < 100');
  await page.getByLabel('Play from 4:00').click();
  await app.waitForAudio('a.currentTime >= 240 && a.currentTime < 250');
  // The episode page's own button now says Pause (the player bar has an icon-only one too).
  await expect(page.getByRole('button').getByText('Pause', { exact: true })).toBeVisible();

  await page.getByLabel('Mark played').click();
  await expect(page.getByLabel('Mark unplayed')).toBeVisible();
  // The show page underneath stays mounted (hidden) and says it too; check the visible one.
  await expect(page.getByText(/^Played · /).filter({ visible: true })).toBeVisible();
});

test('an unknown episode explains itself', async ({ app, page }) => {
  await app.goto('/episode/ep_missing');
  await expect(page.getByText("This episode isn't available.", { exact: false })).toBeVisible();
});

test('sharing copies a link that previews and opens the episode', async ({ app, page }) => {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/episode/${latest!.id}`);

  // A desktop browser without a share dialog: the link is copied.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => ((window as unknown as { __copied: string }).__copied = t) },
    });
  });
  await page.getByLabel('Share episode').click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
  expect(link).toBe(`${API_URL}/s/e/${latest!.id}`);

  // The link's page carries preview tags, then sends people to the episode page.
  const html = await (await fetch(link)).text();
  expect(html).toContain(`<meta property="og:title" content="${latest!.title}">`);
  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`/episode/${latest!.id}$`));
  await expect(page.getByRole('button', { name: /^(Play|Resume)$/ })).toBeVisible();
});
