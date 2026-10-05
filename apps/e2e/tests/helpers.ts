import { test as base, expect, type Page } from '@playwright/test';
import type { Podcast } from '@podcast/shared';

import { API_URL, FIXTURE_URL } from '../src/ports';

/** Records every Audio element the app creates, so tests can read playback position. */
const TRACK_AUDIO = `window.__audios = []; const RealAudio = window.Audio;
  window.Audio = function (...args) { const a = new RealAudio(...args); window.__audios.push(a); return a; };
  window.Audio.prototype = RealAudio.prototype;`;

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    await page.addInitScript(TRACK_AUDIO);
    await use(new App(page));
  },
});
export { expect };

export class App {
  constructor(readonly page: Page) {}

  /**
   * Opens a route and waits for React to hydrate it. The web build is pre-rendered, and clicks
   * or typing before hydration are lost.
   */
  async goto(path: string) {
    await this.page.goto(path);
    // React tags each element it has hydrated; any tagged element under the root will do.
    await this.page.waitForFunction(() =>
      [...(document.getElementById('root')?.querySelectorAll('*') ?? [])].some((e) =>
        Object.keys(e).some((k) => k.startsWith('__reactFiber')),
      ),
    );
  }

  /** The last Audio element's state. */
  audio() {
    return this.page.evaluate(() => {
      const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios.at(-1);
      return a ? { time: a.currentTime, paused: a.paused, volume: a.volume, ended: a.ended } : null;
    });
  }

  async waitForAudio(predicate: string, timeout = 30_000) {
    await this.page.waitForFunction(
      `(() => { const a = window.__audios.at(-1); return !!a && (${predicate}); })()`,
      undefined,
      { timeout },
    );
  }

  /** A value the app saved to IndexedDB (zustand persist), e.g. 'library' or 'player'. */
  stored<T = Record<string, unknown>>(key: string): Promise<T | null> {
    return this.page.evaluate(
      (k) =>
        new Promise<T | null>((resolve) => {
          const open = indexedDB.open('podcast', 1);
          open.onerror = () => resolve(null);
          open.onsuccess = () => {
            try {
              const get = open.result.transaction('kv').objectStore('kv').get(k);
              get.onsuccess = () => resolve(get.result ? JSON.parse(get.result).state : null);
            } catch {
              resolve(null);
            }
          };
        }),
      key,
    );
  }

  async subscribedTitles() {
    const library = await this.stored<{ subscriptions: Record<string, { podcast: Podcast }> }>('library');
    return Object.values(library?.subscriptions ?? {})
      .map((s) => s.podcast.title)
      .sort();
  }

  /** Signs in from Settings with the emailed code (the fixture server captures the email). */
  async signIn(email: string) {
    await this.goto('/settings');
    await this.page.getByLabel('Email address').fill(email);
    await this.page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(this.page.getByLabel('Sign-in code')).toBeVisible();
    const { code } = await sentSignIn(email);
    await this.page.getByLabel('Sign-in code').fill(code);
    await this.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(this.page.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(this.page.getByText(/^Synced at/)).toBeVisible({ timeout: 30_000 });
  }

  async syncNow() {
    await this.goto('/settings');
    await this.page.getByRole('button', { name: 'Sync now' }).click();
    await expect(this.page.getByText(/^Synced at/)).toBeVisible({ timeout: 30_000 });
  }
}

export const feedUrl = (slug: string) => `${FIXTURE_URL}/feeds/${slug}.xml`;

/** Adds a fixture show to the catalog and returns it. */
export async function resolveShow(slug: string): Promise<Podcast> {
  const res = await fetch(`${API_URL}/v1/podcasts/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ feedUrl: feedUrl(slug) }),
  });
  return (await res.json()).podcast;
}

export async function episodesOf(podcast: Podcast) {
  const res = await fetch(`${API_URL}/v1/podcasts/${podcast.id}/episodes?limit=20`);
  return (await res.json()).episodes as { id: string; title: string }[];
}

/** The newest sign-in email the API sent to this address (code and link). */
export async function sentSignIn(email: string): Promise<{ code: string; link: string }> {
  const res = await fetch(`${FIXTURE_URL}/test/sign-in?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error(`No sign-in email sent to ${email}`);
  return res.json();
}

export const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
