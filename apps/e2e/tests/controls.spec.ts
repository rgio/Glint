import { App, episodesOf, expect, resolveShow, test, uniqueEmail } from './helpers';

const playLatest = async (app: App) => {
  const show = await resolveShow('daily');
  const [latest] = await episodesOf(show);
  await app.goto(`/podcast/${show.id}`);
  await app.page.getByLabel(`Play ${latest!.title}`, { exact: true }).click();
  await app.waitForAudio('!a.paused && a.currentTime > 0.5');
};

const rate = (app: App) => app.page.evaluate(() => (window as unknown as { __audios: HTMLAudioElement[] }).__audios.at(-1)!.playbackRate);

test('speed changes in 0.1x steps or by preset, and is remembered', async ({ app, page }) => {
  await playLatest(app);
  await page.getByLabel(/^Now playing: /).click();
  await page.getByLabel('Playback speed 1x. Change speed').click();

  await page.getByLabel('Faster by 0.1x').click();
  await page.getByLabel('Faster by 0.1x').click();
  await expect(page.getByText('1.2x', { exact: true }).first()).toBeVisible();
  expect(await rate(app)).toBeCloseTo(1.2);

  await page.getByRole('radio', { name: '0.8x' }).click();
  expect(await rate(app)).toBeCloseTo(0.8);
  await page.getByRole('radio', { name: '3x' }).click();
  await expect(page.getByLabel('Faster by 0.1x')).toBeDisabled();
  await page.getByLabel('Slower by 0.1x').click();
  expect(await rate(app)).toBeCloseTo(2.9);

  // The speed survives a reload.
  await app.goto('/player');
  await expect(page.getByLabel('Playback speed 2.9x. Change speed')).toBeVisible();
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

test('keyboard: space and K play and pause, arrows skip, < and > change speed', async ({ app, page }) => {
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
  expect(await rate(app)).toBeCloseTo(1.2);
  await page.keyboard.press('Shift+Comma'); // <
  expect(await rate(app)).toBeCloseTo(1.1);

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
