import { episodesOf, expect, resolveShow, test } from './helpers';

test('search finds a show, and charts filter by category', async ({ app, page }) => {
  await app.goto('/discover');
  await expect(page.getByRole('link', { name: /Fixture Weekly/ })).toBeVisible();

  await page.getByRole('tab', { name: 'News' }).click();
  await expect(page.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Trending in News')).toBeVisible();
  await expect(page.getByRole('link', { name: /Fixture Weekly/ })).toBeHidden();

  await page.getByLabel('Search podcasts').fill('season');
  await expect(page.getByRole('link', { name: /Fixture Seasons/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Fixture Daily/ })).toBeHidden();

  await page.getByRole('link', { name: /Fixture Seasons/ }).click();
  await expect(page).toHaveURL(/\/podcast\/pod_/);
  await expect(page.getByRole('button', { name: 'Subscribe' })).toBeVisible();
});

test('plays from a show page, with the player bar on every page', async ({ app, page }) => {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/podcast/${show.id}`);

  await page.getByRole('button', { name: 'Subscribe' }).click();
  await expect(page.getByRole('button', { name: 'Subscribed' })).toBeVisible();

  await page.getByLabel(`Play ${latest!.title}`, { exact: true }).click();
  await app.waitForAudio('a.currentTime > 2 && !a.paused');
  // The mini player shows on the show page, not just on tabs.
  await expect(page.getByLabel(`Now playing: ${latest!.title}. Open player`)).toBeVisible();

  await page.getByLabel('Pause', { exact: true }).click();
  await app.waitForAudio('a.paused');
});

test('resumes where the listener left off after a reload', async ({ app, page }) => {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/podcast/${show.id}`);
  await page.getByLabel(`Play ${latest!.title}`, { exact: true }).click();
  await app.waitForAudio('a.currentTime > 4');
  await page.getByLabel('Pause', { exact: true }).click();
  await app.waitForAudio('a.paused');
  const saved = (await app.stored<{ saved: Record<string, { positionSec: number }> }>('player'))!.saved[latest!.id]!;
  expect(saved.positionSec).toBeGreaterThan(3);

  await page.reload();
  await app.goto('/library');
  await page.getByLabel('Play', { exact: true }).click();
  await app.waitForAudio('!a.paused && a.currentTime > 0');
  const resumed = (await app.audio())!.time;
  expect(resumed).toBeGreaterThanOrEqual(saved.positionSec - 1);
  expect(resumed).toBeLessThan(saved.positionSec + 5);
});

test('clicking or dragging a progress bar seeks', async ({ app, page }) => {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/podcast/${show.id}`);
  await page.getByLabel(`Play ${latest!.title}`, { exact: true }).click();
  await app.waitForAudio('a.duration > 0 && a.currentTime > 1');

  const bar = page.getByLabel('Playback position').first();
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height - 2);
  await app.waitForAudio('Math.abs(a.currentTime - 150) < 5');

  // Drag from 20% to 70%, wandering off the bar on the way.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y - 30, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.7, box.y - 40, { steps: 5 });
  await page.mouse.up();
  await app.waitForAudio('Math.abs(a.currentTime - 210) < 5');

  // The full player's scrubber too.
  await page.getByLabel(/^Now playing: /).click();
  await expect(page).toHaveURL(/\/player$/);
  const full = (await page.getByLabel('Playback position').boundingBox())!;
  await page.mouse.click(full.x + full.width * 0.25, full.y + full.height / 2);
  await app.waitForAudio('Math.abs(a.currentTime - 75) < 5');
});
