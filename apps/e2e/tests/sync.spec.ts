import { App, episodesOf, expect, resolveShow, sentSignIn, test, uniqueEmail } from './helpers';

test('two devices on one account share subscriptions, positions and the queue', async ({ browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('sync');
  const daily = await resolveShow('daily');
  const weekly = await resolveShow('weekly');
  const [first, second] = await episodesOf(daily);

  // Two browser contexts: separate storage and cookies, like two devices.
  const device = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(`window.__audios = []; const RA = window.Audio; window.Audio = function (...a) { const x = new RA(...a); window.__audios.push(x); return x; }; window.Audio.prototype = RA.prototype;`);
    return new App(page);
  };
  const a = await device();
  const b = await device();

  // Signed out, each device subscribes to a different show.
  await a.goto(`/podcast/${daily.id}`);
  await a.page.getByRole('button', { name: 'Subscribe' }).click();
  await b.goto(`/podcast/${weekly.id}`);
  await b.page.getByRole('button', { name: 'Subscribe' }).click();
  await expect(b.page.getByRole('button', { name: 'Subscribed' })).toBeVisible();

  // First sign-in on each device combines their libraries.
  await a.signIn(email);
  await b.signIn(email);
  expect(await b.subscribedTitles()).toEqual(['Fixture Daily', 'Fixture Weekly']);
  await a.syncNow();
  expect(await a.subscribedTitles()).toEqual(['Fixture Daily', 'Fixture Weekly']);

  // A position saved on pause reaches the other device.
  await a.goto(`/podcast/${daily.id}`);
  await a.page.getByLabel(`Play ${first!.title}`, { exact: true }).click();
  await a.waitForAudio('a.currentTime > 6');
  await a.page.getByLabel(`Pause ${first!.title}`, { exact: true }).click();
  await a.waitForAudio('a.paused');
  const position = (await a.stored<{ saved: Record<string, { positionSec: number }> }>('player'))!.saved[first!.id]!.positionSec;
  await expect.poll(async () => (await b.syncNow(), (await b.stored<{ saved: Record<string, { positionSec: number }> }>('player'))?.saved?.[first!.id]?.positionSec), { timeout: 30_000 }).toBeCloseTo(position, 0);

  // So does an Up Next addition.
  await a.goto(`/podcast/${daily.id}`);
  await a.page.getByLabel('Play last').nth(1).click();
  await expect.poll(async () => (await b.syncNow(), ((await b.stored<{ queue: { id: string }[] }>('player'))?.queue ?? []).map((q) => q.id)), { timeout: 30_000 }).toContain(second!.id);

  // And an unsubscribe.
  await b.goto(`/podcast/${weekly.id}`);
  await b.page.getByRole('button', { name: 'Subscribed' }).click();
  await expect.poll(async () => (await a.syncNow(), await a.subscribedTitles()), { timeout: 30_000 }).toEqual(['Fixture Daily']);

  // A reload stays signed in (the refresh cookie) and can still sync.
  await a.page.reload();
  await a.syncNow();
  await expect(a.page.getByText(`Signed in as ${email}`)).toBeVisible();

  // Signing out keeps this device's data.
  await b.goto('/settings');
  await b.page.getByRole('button', { name: 'Sign out' }).click();
  await expect(b.page.getByLabel('Email address')).toBeVisible();
  expect(await b.subscribedTitles()).toContain('Fixture Daily');

  // A third device signs in with the emailed link.
  const c = await device();
  await c.goto('/settings');
  await c.page.getByLabel('Email address').fill(email);
  await c.page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(c.page.getByLabel('Sign-in code')).toBeVisible();
  await c.page.goto((await sentSignIn(email)).link);
  await expect(c.page.getByText(`Signed in as ${email}`)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => c.subscribedTitles(), { timeout: 30_000 }).toEqual(['Fixture Daily']);

  // Deleting the account signs other devices out on their next sync (opening the app syncs).
  await c.page.getByRole('button', { name: 'Delete account…' }).click();
  await c.page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(c.page.getByLabel('Email address')).toBeVisible();
  await a.goto('/settings');
  await expect(a.page.getByLabel('Email address')).toBeVisible({ timeout: 30_000 });
  expect(await a.subscribedTitles()).toEqual(['Fixture Daily']);
});
