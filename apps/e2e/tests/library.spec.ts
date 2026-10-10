import { readFileSync, writeFileSync } from 'node:fs';

import { feedUrl, expect, test } from './helpers';

test('imports and exports subscriptions as OPML', async ({ app, page }, info) => {
  const opml = info.outputPath('import.opml');
  writeFileSync(
    opml,
    `<?xml version="1.0"?><opml version="2.0"><head><title>Elsewhere</title></head><body>
      <outline text="Daily" xmlUrl="${feedUrl('daily')}"/>
      <outline text="Folder"><outline text="Weekly" xmlUrl="${feedUrl('weekly')}"/></outline>
      <outline text="Daily again" xmlUrl="${feedUrl('daily')}"/>
      <outline text="Gone show" xmlUrl="${feedUrl('gone')}"/>
      <outline text="Local" xmlUrl="file:///Users/me/feed.xml"/>
    </body></opml>`,
  );

  await app.goto('/library');
  await expect(page.getByRole('button', { name: 'Export OPML' })).toHaveAttribute('aria-disabled', 'true');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import OPML' }).click();
  await (await chooser).setFiles(opml);
  await expect(page.getByText('Found 3 shows in the file')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("2 added · 1 couldn't be added · 1 entry wasn't a feed")).toBeVisible();
  await expect(page.getByText('Gone show: Feed returned HTTP 404')).toBeVisible();
  expect(await app.subscribedTitles()).toEqual(['Fixture Daily', 'Fixture Weekly']);

  // Rows put the artwork beside the title (a regression: it once stacked above).
  const row = page.getByRole('link', { name: /Fixture Daily/ });
  const title = row.getByText('Fixture Daily', { exact: true });
  const [rowBox, titleBox] = [(await row.boundingBox())!, (await title.boundingBox())!];
  expect(titleBox.x - rowBox.x).toBeGreaterThan(40);

  // Importing again skips what's already there.
  await page.getByRole('button', { name: 'Done' }).click();
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import OPML' }).click();
  await (await again).setFiles(opml);
  await expect(page.getByText(/0 added · 2 already in your library/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export OPML' }).click();
  const file = await (await download).path();
  const exported = readFileSync(file, 'utf8');
  expect([...exported.matchAll(/xmlUrl="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual([feedUrl('daily'), feedUrl('weekly')]);
});

test('a file that is not OPML shows an error', async ({ app, page }, info) => {
  const bad = info.outputPath('notes.txt');
  writeFileSync(bad, 'hello, this is not OPML');
  await app.goto('/library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import OPML' }).click();
  await (await chooser).setFiles(bad);
  await expect(page.getByText("Couldn't import that file")).toBeVisible();
});

test("Home's badge counts new, unplayed episodes and clears after a visit", async ({ app, page }) => {
  await app.goto('/library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import OPML' }).click();
  const opml = test.info().outputPath('two.opml');
  writeFileSync(opml, `<opml><body><outline text="D" xmlUrl="${feedUrl('daily')}"/><outline text="W" xmlUrl="${feedUrl('weekly')}"/></body></opml>`);
  await (await chooser).setFiles(opml);
  await expect(page.getByText('Found 2 shows in the file')).toBeVisible({ timeout: 30_000 });

  // Within the last week: all 6 daily episodes and 1 weekly one.
  const home = page.getByRole('link', { name: /^Home/ });
  await expect(home).toHaveAccessibleName('Home, 7 new episodes', { timeout: 30_000 });

  await home.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(home).toHaveAccessibleName('Home');
  await page.getByRole('link', { name: 'Discover' }).click();
  await expect(home).toHaveAccessibleName('Home');

  // Home keeps listing the latest unplayed episodes after the visit, newest first.
  await home.click();
  await expect(page.getByText('Latest', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Play Daily episode/)).toHaveCount(6);
  await expect(page.getByLabel(/^Play Weekly episode/).first()).toBeVisible();
});

test('Settings opens from the gear on Home; Up Next from Library', async ({ app, page }) => {
  await app.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await app.goto('/library');
  await page.getByRole('link', { name: 'Up Next, 0' }).click();
  await expect(page).toHaveURL(/\/queue$/);
  await expect(page.getByText('Your queue is empty')).toBeVisible();
});
