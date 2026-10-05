import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';
import type { Highlight } from '@podcast/shared';

import { App, episodesOf, expect, resolveShow, test, uniqueEmail } from './helpers';

/** Starts the newest daily episode and seeks to `seconds` by clicking the player bar. */
async function playAt(app: App, page: Page, seconds: number) {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/podcast/${show.id}`);
  await page.getByLabel(`Play ${latest!.title}`, { exact: true }).click();
  await app.waitForAudio('a.duration > 0 && a.currentTime > 0.5');
  if (seconds > 2) {
    const box = (await page.getByLabel('Playback position').first().boundingBox())!;
    await page.mouse.click(box.x + (box.width * seconds) / 300, box.y + box.height - 2);
    await app.waitForAudio(`Math.abs(a.currentTime - ${seconds}) < 3`);
  }
  return latest!;
}

const highlights = async (app: App) =>
  Object.values((await app.stored<{ items: Record<string, Highlight> }>('highlights'))?.items ?? {}).filter((h) => !h.deleted);

test('captures the last 30 seconds from the player, adds a note, and shows it on the episode', async ({ app, page }) => {
  const episode = await playAt(app, page, 90);
  await page.getByLabel(/^Now playing: /).click();
  await page.getByLabel('Highlight the last 30 seconds').click();
  await expect(page.getByRole('status')).toContainText(/^Highlighted \d+:\d\d–\d+:\d\d/);

  // A second press within 10 seconds extends the same highlight.
  await page.getByLabel('Highlight the last 30 seconds').click();
  await expect.poll(async () => (await highlights(app)).length).toBe(1);

  await page.getByRole('status').getByText('Add note').click();
  const editor = page.getByRole('dialog', { name: 'Highlight note' });
  await editor.getByLabel('Note', { exact: true }).fill('Try this on the onboarding flow');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await app.waitForAudio('!a.paused'); // writing a note never pauses playback

  await app.goto(`/episode/${episode.id}`);
  await expect(page.getByText('Highlights', { exact: true })).toBeVisible();
  await expect(page.getByText('Try this on the onboarding flow')).toBeVisible();
  const [h] = await highlights(app);
  expect(h!.endSec - h!.startSec).toBeGreaterThanOrEqual(29);
  expect(h!.source).toBe('player');
});

test('H highlights on the web, Shift+H opens the note, and typing doesn\'t trigger it', async ({ app, page }) => {
  await playAt(app, page, 60);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('h');
  await expect(page.getByRole('status')).toContainText('Highlighted');
  expect((await highlights(app))[0]!.source).toBe('keyboard');

  await page.getByRole('status').getByText('Undo').click();
  await expect.poll(async () => (await highlights(app)).length).toBe(0);

  await page.keyboard.press('Shift+H');
  await expect(page.getByRole('dialog', { name: 'Highlight note' })).toBeVisible();
  // Typing an "h" in the note doesn't capture another highlight.
  await page.getByLabel('Note', { exact: true }).fill('h is for highlight');
  await page.keyboard.press('h');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await highlights(app)).map((h) => h.note)).toEqual(['h is for highlighth']);
});

test('plays just the highlighted range, adjusts it, shares a quote, and deletes with undo', async ({ app, page }) => {
  // At 5 s in, the highlight is the first 5 seconds: quick to play through.
  const episode = await playAt(app, page, 0);
  await app.waitForAudio('a.currentTime > 5');
  await page.keyboard.press('h');
  await page.getByLabel('Pause', { exact: true }).click();
  await app.goto(`/episode/${episode.id}`);

  const card = page.getByLabel(/^Highlight 0:00–0:0\d$/);
  await card.getByLabel(/^Play highlight/).click();
  await app.waitForAudio('!a.paused && a.currentTime < 3');
  await app.waitForAudio('a.paused', 15_000);
  const end = (await highlights(app))[0]!.endSec;
  expect((await app.audio())!.time).toBeGreaterThanOrEqual(end - 0.5);
  expect((await app.audio())!.time).toBeLessThan(end + 1.5);

  await card.getByRole('button', { name: 'Adjust range' }).click();
  await card.getByLabel('Move end 5 seconds later').click();
  await expect.poll(async () => (await highlights(app))[0]!.endSec).toBeCloseTo(end + 5, 0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => ((window as unknown as { __copied: string }).__copied = t) },
    });
  });
  await page.getByLabel(/^Share quote/).click();
  await expect(page.getByText('Quote copied')).toBeVisible();
  const quote = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
  expect(quote).toContain(`${episode.title}, Fixture Daily (0:00–0:`);
  expect(quote).toContain(`/s/e/${episode.id}`);

  await page.getByLabel(/^Delete highlight/).click();
  await expect(page.getByRole('status')).toContainText('Highlight deleted');
  await expect.poll(async () => (await highlights(app)).length).toBe(0);
  await page.getByRole('status').getByText('Undo').click();
  await expect.poll(async () => (await highlights(app)).length).toBe(1);
});

test('the Highlights page searches, filters and exports Markdown', async ({ app, page }) => {
  await playAt(app, page, 60);
  await page.keyboard.press('Shift+H');
  await page.getByLabel('Note', { exact: true }).fill('Pricing idea');
  await page.getByRole('button', { name: 'Save' }).click();
  const box = (await page.getByLabel('Playback position').first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height - 2);
  await app.waitForAudio('a.currentTime > 175');
  await page.keyboard.press('h');
  await expect.poll(async () => (await highlights(app)).length).toBe(2);

  await app.goto('/library');
  await page.getByRole('link', { name: 'Highlights, 2' }).click();
  await expect(page.getByLabel(/^Highlight \d/)).toHaveCount(2);

  await page.getByRole('checkbox', { name: 'Has a note' }).click();
  await expect(page.getByLabel(/^Highlight \d/)).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Has a note' }).click();
  await page.getByLabel('Search highlights').fill('pricing');
  await expect(page.getByLabel(/^Highlight \d/)).toHaveCount(1);
  await page.getByLabel('Search highlights').fill('fixture daily');
  await expect(page.getByLabel(/^Highlight \d/)).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as Markdown' }).click();
  const md = readFileSync(await (await download).path(), 'utf8');
  expect(md).toContain('## Fixture Daily');
  expect(md).toMatch(/- \*\*\d+:\d\d–\d+:\d\d\*\* Pricing idea/);
  expect(md).toContain('_No note_');
});

test('highlights and their notes sync between devices', async ({ browser }) => {
  test.setTimeout(150_000);
  const email = uniqueEmail('highlights');
  const device = async () => {
    const page = await (await browser.newContext()).newPage();
    await page.addInitScript(`window.__audios = []; const RA = window.Audio; window.Audio = function (...a) { const x = new RA(...a); window.__audios.push(x); return x; }; window.Audio.prototype = RA.prototype;`);
    return new App(page);
  };
  const a = await device();
  const b = await device();
  await a.signIn(email);
  await b.signIn(email);

  const episode = await playAt(a, a.page, 60);
  await a.page.keyboard.press('Shift+H');
  await a.page.getByLabel('Note', { exact: true }).fill('From device A');
  await a.page.getByRole('button', { name: 'Save' }).click();
  await a.page.getByLabel('Pause', { exact: true }).click(); // pausing syncs

  await expect.poll(async () => (await b.syncNow(), (await highlights(b)).map((h) => h.note)), { timeout: 30_000 }).toEqual(['From device A']);
  await b.goto(`/episode/${episode.id}`);
  await expect(b.page.getByText('From device A')).toBeVisible();

  // B edits the note; A sees the edit.
  await b.page.getByLabel(/^Edit note: From device A$/).click();
  await b.page.getByLabel('Note', { exact: true }).fill('Edited on B');
  await b.page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await a.syncNow(), (await highlights(a)).map((h) => h.note)), { timeout: 30_000 }).toEqual(['Edited on B']);
});
