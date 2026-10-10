import { App, episodesOf, expect, resolveShow, test, uniqueEmail } from './helpers';

const playLatest = async (app: App) => {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/podcast/${show.id}`);
  await app.page.getByLabel(`Play ${latest!.title}`, { exact: true }).click();
  await app.waitForAudio('!a.paused && a.currentTime > 0.5');
};

const rate = (app: App) => app.page.evaluate(() => (window as unknown as { __audios: HTMLAudioElement[] }).__audios.at(-1)!.playbackRate);

test('speed is chosen from a menu, and is remembered', async ({ app, page }) => {
  await playLatest(app);
  await page.getByLabel(/^Now playing: /).click();
  await page.getByLabel('Playback speed 1x. Change speed').click();

  const menu = page.getByRole('radiogroup', { name: 'Playback speed' });
  await expect(menu.getByRole('radio')).toHaveCount(7);
  const names = await menu.getByRole('radio').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(names).toEqual(['0.5x', '0.75x', '1x', '1.25x', '1.5x', '1.75x', '2x']);
  await expect(menu.getByRole('radio', { name: '1x', exact: true })).toBeChecked();

  await menu.getByRole('radio', { name: '1.25x' }).click();
  await expect(menu).toBeHidden();
  expect(await rate(app)).toBeCloseTo(1.25);

  await page.getByLabel('Playback speed 1.25x. Change speed').click();
  await page.getByRole('radio', { name: '0.75x' }).click();
  expect(await rate(app)).toBeCloseTo(0.75);

  // The speed survives a reload.
  await app.goto('/player');
  await expect(page.getByLabel('Playback speed 0.75x. Change speed')).toBeVisible();
});

test('play at the end of an episode starts it over', async ({ app, page }) => {
  await playLatest(app);
  await page.evaluate(() => {
    const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios.at(-1)!;
    a.currentTime = a.duration - 1;
  });
  await app.waitForAudio('a.paused && a.currentTime > a.duration - 2', 15_000);
  await page.getByLabel('Play', { exact: true }).first().click();
  await app.waitForAudio('!a.paused && a.currentTime < 10');
});

test('skip intervals are chosen in Settings', async ({ app, page }) => {
  await app.goto('/settings');
  await page.getByRole('radiogroup', { name: 'Skip back' }).getByRole('radio', { name: '30 seconds' }).click();
  await page.getByRole('radiogroup', { name: 'Skip forward' }).getByRole('radio', { name: '10 seconds' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Skip back' }).getByRole('radio', { name: '30 seconds' })).toBeChecked();

  await playLatest(app);
  await page.getByLabel(/^Now playing: /).click();
  await expect(page.getByLabel('Skip back 30 seconds')).toBeVisible();
  const before = (await app.audio())!.time;
  await page.getByLabel('Skip forward 10 seconds').click();
  await app.waitForAudio(`a.currentTime >= ${before + 9}`);
  expect((await app.audio())!.time).toBeLessThan(before + 14);
});

test('keyboard: space and K play and pause, arrows skip, < and > step through the speeds', async ({ app, page }) => {
  await playLatest(app);
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Space');
  await app.waitForAudio('a.paused');
  await page.keyboard.press('k');
  await app.waitForAudio('!a.paused');

  const before = (await app.audio())!.time;
  await page.keyboard.press('ArrowRight');
  await app.waitForAudio(`a.currentTime >= ${before + 25}`);
  await page.keyboard.press('j');
  await app.waitForAudio(`a.currentTime < ${before + 25}`);

  await page.keyboard.press('Shift+Period'); // >
  await page.keyboard.press('Shift+Period');
  expect(await rate(app)).toBeCloseTo(1.5);
  await page.keyboard.press('Shift+Comma'); // <
  expect(await rate(app)).toBeCloseTo(1.25);

  // Typing in a field doesn't trigger anything.
  await app.goto('/discover');
  await page.getByLabel('Search podcasts').pressSequentially(' kj');
  expect((await app.audio())?.paused ?? true).toBe(true);
});

test('two tabs refreshing their sign-in at the same moment both stay signed in', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const first = new App(await context.newPage());
  await first.signIn(uniqueEmail('tabs'));

  // Both tabs open at once with no access token, so both refresh with the one shared cookie.
  // Refreshes are held until both tabs have sent one (as on a slow network), or for 3 seconds:
  // with the tabs taking turns, the second only asks once the first has its answer.
  const held: (() => void)[] = [];
  await context.route('**/v1/auth/refresh', async (route) => {
    // Read the headers now so each request keeps the cookie it was made with.
    const headers = await route.request().allHeaders();
    await new Promise<void>((resolve) => {
      held.push(resolve);
      if (held.length >= 2) held.forEach((release) => release());
      setTimeout(resolve, 3000);
    });
    await route.continue({ headers });
  });
  const second = new App(await context.newPage());
  await Promise.all([first.goto('/settings'), second.goto('/settings')]);
  for (const tab of [first, second]) {
    // Each tab syncs on opening; a tab that lost the race would show the sign-in form instead.
    await expect(tab.page.getByText(/^Synced at/).or(tab.page.getByLabel('Email address'))).toBeVisible({ timeout: 30_000 });
    await expect(tab.page.getByText(/^Synced at/)).toBeVisible();
  }
  await context.close();
});
