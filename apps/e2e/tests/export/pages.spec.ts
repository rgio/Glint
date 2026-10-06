import { episodesOf, expect, resolveShow, test } from '../helpers';

/** Opens a page of the production build, failing on any error thrown on the page. */
const open = async (page: import('@playwright/test').Page, path: string) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const response = await page.goto(path);
  await page.waitForLoadState('networkidle');
  return { status: response?.status(), errors };
};

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport });

    test('every page renders without errors, including deep links', async ({ page }) => {
      const show = await resolveShow('daily');
      const [latest] = await episodesOf(show);
      const pages: [string, RegExp | string][] = [
        ['/', 'Home'],
        ['/discover', 'Discover'],
        ['/library', 'Library'],
        ['/queue', 'Up Next'],
        ['/settings', 'Account'],
        ['/highlights', 'Highlights'],
        [`/podcast/${show.id}`, 'Fixture Daily'],
        [`/episode/${latest!.id}`, latest!.title],
      ];
      for (const [path, text] of pages) {
        const { status, errors } = await open(page, path);
        expect(status, path).toBe(200);
        await expect(page.getByText(text, { exact: true }).first(), path).toBeVisible();
        expect(errors, path).toEqual([]);
      }
    });
  });
}

test('an unknown address gets the not-found page with a 404', async ({ page }) => {
  const { status } = await open(page, '/no-such-page');
  expect(status).toBe(404);
});

test('the wide tab bar shows on desktop from the first render', async ({ page }) => {
  await open(page, '/library');
  await expect(page.getByText('Podcast', { exact: true })).toBeVisible();
});
