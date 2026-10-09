# Status and open TODOs

Checked against the code on 2026-10-01 (updated later that day after persistence, web player fixes, and search + discovery landed). Legend: ✅ done · 🟡 partial · ⬜ not started.

## v1 (P0) features

| ID | Feature | Status | Where / what's missing |
| --- | --- | --- | --- |
| F-01 | Discovery (Podcast Index trending + categories) | 🟡 | `GET /v1/discover?section=top\|category:<id>` and `/v1/discover/categories` (`apps/api/src/podcast-index.ts`), and a Trending list with category chips on Discover, filtered to the device language (`src/lib/locale.ts`). Verified against the live Podcast Index API. Missing: region filtering. Note that Podcast Index "trending" ranks recent activity, not popularity, so the Top list skews toward small, recently active shows. |
| F-02 | Search | 🟡 | `GET /v1/search?q=` (Podcast Index `search/byterm`, cached 10 min) and a debounced search box on Discover. Shows only: Podcast Index has no full-text episode search, so `type=episode` from the spec isn't built. Search has no language filter upstream. Verified against the live API. |
| F-03 | Subscribe (search, show page, RSS URL) + OPML | ✅ | Add by RSS URL and from search or charts (`POST /v1/podcasts/resolve`); subscriptions persist. OPML import and export on Library: parsing and writing in `packages/feed-parser` (`parseOpml`, `buildOpml`), import adds feeds 4 at a time with progress and a failure list, skipping shows already subscribed. Export downloads a file on web and opens the share sheet on phones (not yet tried on a device). Done on the device; the spec's `/v1/me/opml` endpoints wait for accounts. |
| F-04 | Show page | ✅ | Artwork, paged episodes, a Newest/Oldest sort, "Season N" headings for shows with two or more seasons, and "Play latest" (always the newest, whatever the sort). |
| F-05 | Episode page / show notes | ✅ | `/episode/[id]` (via `GET /v1/episodes/:id`), opened from any episode row. Show notes are parsed with htmlparser2 into a safe subset (text, emphasis, http/https/mailto links, headings, quotes, lists) and rendered natively (`src/lib/show-notes.ts`, unit-tested); timestamps within the episode's length play from that point. Images aren't shown. |
| F-06 | Playback | ✅ | Play, pause, seek and skip. Speed from the full player: 0.1x steps from 0.5x, plus presets from 0.8x to 3x. Skip intervals (10, 15 or 30 s each way) in Settings; speed and skips sync. Web keyboard shortcuts: Space/K play and pause, ←/J and →/L skip, < and > change speed, H highlights. Native speed is capped at 2.0x by expo-audio. |
| F-07 | Queue | 🟡 | Play next, play last, auto-advance, remove, and move up/down buttons work. Missing: drag to reorder and swipe to remove. |
| F-08 | Resume | ✅ | Position is saved every 10 s, on pause, on seek and when the app is backgrounded, persists across restarts, and syncs to other devices signed into the same account. |
| F-09 | Played state | ✅ | Auto-mark at 95% or fewer than 30 s left, plus a mark played/unplayed button on every episode row; both persist. |
| F-10 | Downloads (mobile) | ⬜ | Not started. Needs a `DownloadManager` interface and expo-file-system. |
| F-11 | Home "New" section | ✅ | New episodes since the last visit, and a badge on the Home tab (web and native) counting the unplayed ones, hidden while Home is open. Subscriptions are re-checked every 15 min while the app is open. |
| F-12 | Accounts (optional, signed-out works) | 🟡 | Email sign-in: the email has a link (web, `/sign-in?token=`) and a 6-digit code (any device). 15-minute access tokens, 90-day refresh tokens rotated on use (Keychain/Keystore via expo-secure-store on phones, an HttpOnly cookie on web). Sign-out, and account deletion (`DELETE /v1/me`). First sign-in on a device combines subscriptions and keeps the furthest position. Settings screen (`/settings`), linked from Library. Sign-in emails go through Resend or Postmark (`EMAIL_PROVIDER`); development writes them to the API log. **Missing:** Sign in with Apple and Google (need an Apple developer team and a Google OAuth client), and a provider account and verified sending domain. |
| F-13 | Sync (pull-based) | ✅ | `POST /v1/sync` / `GET /v1/sync?since=` with a server-wide version sequence as the cursor. The client (`src/sync/engine.ts`) records changes by diffing the library and player stores into an outbox (newest per record), and syncs on launch, return to foreground, pause, every 60 s while playing, and 3 s after other changes. Subscriptions, queue, positions, played state and speed/skip settings. Verified with two browsers on one account. Highlights sync too. Web tabs take turns refreshing the sign-in (a Web Lock), so two tabs opening at once no longer sign one of them out. |
| F-14 | Sleep timer | ✅ | 5/15/30/60 min or end of episode from the full player, with a live countdown and a fade over the last 10 s (`src/components/sleep-timer.tsx`, rules in `packages/shared`). End of episode stops instead of starting the next queued episode. The timer isn't persisted. iOS Safari ignores scripted volume, so there the fade is silent but the stop still works. Native not yet tested on a device. |
| F-15 | Share episode link | ✅ | A Share button on the episode page and full player (native share sheet; on web the browser's share dialog, else copy with "Link copied"). Links point at `/s/e/:id` on the API, a small page with Open Graph tags for chat-app previews that redirects to the web app's episode page (`WEB_URL`). Expo's server rendering isn't stable until SDK 58, so previews don't come from the web app itself. Production needs a public domain for `/s/` (`EXPO_PUBLIC_SHARE_URL`) and `trustProxy` behind a proxy; universal/app links come later. Native share not yet tried on a device. |

| — | Highlights (phase 1 of the [highlights spec](05-highlights-spec.md)) | ✅ | A Highlight button in the full player and player bar, and H / Shift+H on the web, save the last 30 s heard (listening time, so more audio at higher speeds); a repeat press within 10 s extends it unless the listener has skipped ahead. Toast with Add note and Undo; notes never pause playback. Scrubber shading, a Highlights section on the episode page (play just the range, adjust ±5 s, share as a quote, delete with undo) and a Highlights page from Library (search, "Has a note" filter, Markdown export). Syncs as a `highlight` change, merged field by field (range and note separately; deletion wins). Phases 2 and 3 (transcripts via dLogos, hands-free capture) wait on decisions in `TODO.md`. |

P1 and P2 items (F-16 to F-27) are not started, as planned. The feed parser already extracts `chaptersUrl` and `transcriptUrl` for F-16.

## Platform / infrastructure

| Item | Status | Notes |
| --- | --- | --- |
| Monorepo (pnpm + Turbo) | ✅ | |
| Shared models + rules | ✅ | Unit-tested |
| Lenient feed parser | ✅ | One fixture. The spec wants a 500-feed snapshot corpus. |
| API: resolve feed, podcast, episodes | ✅ | Postgres when `DATABASE_URL` is set, in memory otherwise |
| Safe feed fetching (SSRF guard, ETag) | ✅ | |
| `AudioPlayer` native + web | ✅ | Background playback config and lock screen via expo-audio; Media Session on web |
| Local persistence | ✅ | Zustand `persist` over a key-value store: IndexedDB on web, `expo-sqlite/kv-store` on native (`src/storage/`). Library and player state (subscriptions, queue, positions, played, speed) survive reloads; verified in a browser. Not a relational DB yet; revisit when sync needs an outbox. |
| PostgreSQL `CatalogStore` | ✅ | `apps/api/src/postgres-store.ts` with SQL migrations in `src/db/migrations` (applied on startup). One contract test suite runs against both stores (`test/store.test.ts`; the Postgres half needs `TEST_DATABASE_URL`). The client also re-adds a show by its saved feed URL if the server ever answers 404 for it. |
| Feed worker (adaptive polling, WebSub) | 🟡 | `apps/feed-worker` polls due feeds every 30 s (`pollDueFeeds` in `packages/catalog`): about 96 polls per typical gap between episodes, so every 15 min for daily shows up to every 24 h for inactive ones; failures double the wait; feeds are leased with `for update skip locked`, so several workers can run. Missing: WebSub (needs a public callback URL). The API's on-request refresh of feeds over an hour old remains as a safety net. |
| Production setup | 🟡 | See `docs/deploy.md`. One server image (`Dockerfile`: API, worker, `migrate`), built and smoke-tested in CI. API settings validated on start (production refuses missing or unsafe values, listing all of them). Per-IP rate limits, security headers and HSTS, `TRUST_PROXY`, `/ready` checks the database. The web build (`expo export`) is checked in a browser in CI (`pnpm e2e:export`) with the hosting rules the doc lists. Missing: a chosen host and its config, Redis-backed rate limits, Sentry. |
| Redis, object storage / CDN | ⬜ | |
| Settings screen, onboarding, `/episode/[id]` route | 🟡 | Settings (account, skip intervals) and the episode page are built. Onboarding isn't. |
| Wide-screen layout (sidebar + right-hand player at >1024 px) | ⬜ | |
| i18n (i18next, EN + ES), web keyboard shortcuts | 🟡 | Keyboard shortcuts done (see F-06). i18n not started. |
| Component tests, Maestro, Playwright E2E | 🟡 | Vitest for plain client logic (`pnpm test`). Playwright web suite in `apps/e2e` (`pnpm e2e`, 22 tests: discover, playback and seeking, resume, episode notes and timestamps, sharing, OPML, Home badge, seasons, sleep timer, speed, skip settings, keyboard shortcuts, highlights, two-device sync, two tabs refreshing at once). It runs against a fixture server (feeds and audio served locally) and the real API with a fake Podcast Index, so it needs no network. Missing: component tests and Maestro for native. |
| CI (lint, typecheck, tests, EAS preview builds) | 🟡 | `.github/workflows/ci.yml`: lint, typecheck and unit tests with a Postgres service; the Playwright suite and the production web build check (report uploaded on failure); and the server image, built and started against Postgres. Not yet run on GitHub: it starts with the next push. Missing: EAS preview builds. |
| Sentry, analytics | ⬜ | |
| Git repo at `podcast-app/` | ✅ | The nested `apps/client/.git` was removed and the client committed into the main repo (`17a1a8f`). |
| Real bundle id / package name | ⬜ | `com.example.podcast` is a placeholder |
| Real `User-Agent` contact URL | 🟡 | Now `PodcastApp/0.1` in `apps/api/src/fetch-feed.ts`: Podcast Index answered 403 to the `example.com` placeholder. Add a real contact URL once the app has a home. |

## Suggested next steps

1. ~~Initialize git at `podcast-app/` and remove the nested `apps/client/.git`.~~ Done.
2. ~~Get a Podcast Index key and check search and charts against the real service.~~ Done. Note: quote the secret in `.env` if it contains `#`.
3. Run the slice on an iOS simulator and an Android emulator to confirm background audio and lock-screen controls. This is the spec's phase-1 "audio spike" gate.
4. ~~Add local persistence for the player and library stores.~~ Done (key-value; see above).
5. ~~Postgres `CatalogStore` and a feed worker with adaptive polling.~~ Done; run it with `pnpm dev:worker`. WebSub is still to do.
6. ~~Podcast Index integration for search (F-02) and trending (F-01).~~ Built; needs the key (step 2).
7. ~~Sleep timer (F-14).~~ Done. ~~OPML (F-03).~~ Done. Next: downloads (F-10), after the phone test.
8. ~~Accounts and sync (F-12, F-13).~~ Done for email sign-in. Email providers are built in (Resend, Postmark); next, an account with one, then Sign in with Apple and Google once credentials exist.
9. Choose hosting; the server image, settings and web hosting rules are ready (`docs/deploy.md`).

## Open questions (from the spec)

- Business model: free, freemium (sync and effects behind a subscription), or listener-supported?
- Build our own catalog search index, or rely on Podcast Index search at launch?
- Web offline listening via a service worker in v1.x?
- Launch markets and languages beyond English and Spanish?
- A desktop app (Electron or Tauri wrapper), or is the browser enough?
- Native audio library: stay on `expo-audio` (2x cap) or move to `react-native-track-player` as the spec originally said? *(Raised by the build, not discussed with Rob.)*
