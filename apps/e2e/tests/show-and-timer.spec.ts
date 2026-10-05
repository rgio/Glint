import { episodesOf, expect, resolveShow, test } from './helpers';

test('show pages sort newest or oldest, with season headings, and Play latest plays the newest', async ({ app, page }) => {
  const show = await resolveShow('seasons');
  await app.goto(`/podcast/${show.id}`);

  const sort = page.getByRole('radiogroup', { name: 'Sort episodes' });
  await expect(sort.getByRole('radio', { name: 'Newest' })).toHaveAttribute('aria-checked', 'true');
  const headings = () => page.getByRole('heading').filter({ hasText: /^season \d$/i }).allInnerTexts();
  await expect.poll(headings).toEqual(['SEASON 2', 'SEASON 1']);

  await sort.getByRole('radio', { name: 'Oldest' }).click();
  await expect.poll(headings).toEqual(['SEASON 1', 'SEASON 2']);
  await expect(page.getByLabel(/^Play Season \d, episode \d$/).first()).toHaveAccessibleName('Play Season 1, episode 1');

  await page.getByRole('button', { name: 'Play latest' }).click();
  await expect(page.getByLabel(/^Now playing: /)).toHaveAccessibleName('Now playing: Season 2, episode 3. Open player');

  // A show without seasons has no headings.
  const daily = await resolveShow('daily');
  await app.goto(`/podcast/${daily.id}`);
  await expect(page.getByLabel(/^Play Daily episode/).first()).toBeVisible();
  await expect.poll(headings).toEqual([]);
});

test('the sleep timer fades out and stops', async ({ app, page }) => {
  // Lets the test move the page's clock forward without waiting minutes.
  await page.addInitScript(() => {
    const w = window as unknown as { __offset: number };
    w.__offset = 0;
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + w.__offset;
  });
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/podcast/${show.id}`);
  await page.getByLabel(`Play ${latest!.title}`, { exact: true }).click();
  await app.waitForAudio('!a.paused && a.currentTime > 1');
  await page.getByLabel(/^Now playing: /).click();

  await page.getByLabel('Sleep timer: off. Set').click();
  const options = page.getByRole('radiogroup', { name: 'Sleep timer' }).getByRole('radio');
  await expect(options).toHaveText(['5 min', '15 min', '30 min', '60 min', 'End of episode', 'Off']);
  await page.getByRole('radio', { name: '5 min', exact: true }).click();
  const pill = page.getByLabel(/^Sleep timer: \d+:\d\d\. Change$/);
  await expect(pill).toBeVisible();

  // Jump to 5 seconds before the end: about half volume, still playing.
  // The pill's text includes the moon icon's glyph, so pick the time out with a pattern.
  const [, m, s] = /(\d+):(\d\d)/.exec(await pill.innerText())!.map(Number);
  await page.evaluate((ms) => ((window as unknown as { __offset: number }).__offset += ms), (m! * 60 + s! - 5) * 1000);
  await app.waitForAudio('a.volume > 0.2 && a.volume < 0.7 && !a.paused', 5_000);

  await page.evaluate(() => ((window as unknown as { __offset: number }).__offset += 6000));
  await app.waitForAudio('a.paused && a.volume === 1', 5_000);
  await expect(page.getByLabel('Sleep timer: off. Set')).toBeVisible();
});
