# Status and open TODOs

Checked against the code on 2026-10-01 (updated later that day after persistence, web player fixes, and search + discovery landed). Legend: ✅ done · 🟡 partial · ⬜ not started.

## v1 (P0) features

| ID | Feature | Status | Where / what's missing |
| --- | --- | --- | --- |
| F-01 | Discovery (Podcast Index trending + categories) | 🟡 | `GET /v1/discover?section=top\|category:<id>` and `/v1/discover/categories` (`apps/api/src/podcast-index.ts`), and a Trending list with category chips on Discover. Missing: filtering by the user's language/region (the API accepts `lang`, the client doesn't send it yet). **Only tested against a fake directory:** needs a Podcast Index key in `apps/api/.env` to run for real. |
| F-02 | Search | 🟡 | `GET /v1/search?q=` (Podcast Index `search/byterm`, cached 10 min) and a debounced search box on Discover. Shows only: Podcast Index has no full-text episode search, so `type=episode` from the spec isn't built. Same key caveat as F-01. |
| F-03 | Subscribe (search, show page, RSS URL) + OPML | 🟡 | Add by RSS URL and from search or charts works (`POST /v1/podcasts/resolve`), and subscribe/unsubscribe works and persists (`library/store.ts`). Missing: OPML import/export. |
| F-04 | Show page | 🟡 | `podcast/[id].tsx` has artwork, paged episodes and "Play latest". Missing: a sort toggle in the UI (the API supports it) and season grouping. |
| F-05 | Episode page / show notes | 🟡 | Episode rows show notes as plain text (`htmlToText`). Missing: an `/episode/[id]` route, sanitized HTML rendering, and tappable timestamps. |
| F-06 | Playback | 🟡 | Play, pause, seek, skip 15/30 s and speed presets work. Missing: configurable skip intervals in settings and 0.1 speed steps in the UI. Native speed is capped at 2.0x by expo-audio. |
| F-07 | Queue | 🟡 | Play next, play last, auto-advance, remove, and move up/down buttons work. Missing: drag to reorder and swipe to remove. |
| F-08 | Resume | 🟡 | Position is saved every 10 s, on pause, on seek and when the app is backgrounded, and persists across restarts. Missing: cross-device resume (needs sync). |
| F-09 | Played state | 🟡 | Auto-mark at 95% or fewer than 30 s left works and persists. Missing: a manual mark played/unplayed control (`setPlayed` exists in the store but nothing in the UI calls it). |
| F-10 | Downloads (mobile) | ⬜ | Not started. Needs a `DownloadManager` interface and expo-file-system. |
| F-11 | Home "New" section | 🟡 | Built in `(tabs)/index.tsx` from `lastHomeVisitAt`. Missing: the unplayed badge on the tab. |
| F-12 | Accounts (optional, signed-out works) | ⬜ | No auth. The sign-in merge rule exists in `packages/shared` (`mergeOnSignIn`). |
| F-13 | Sync (pull-based) | ⬜ | Merge rules and the `SyncChange` type exist in shared. Missing: outbox, `/v1/sync` endpoints and the SyncEngine. |
| F-14 | Sleep timer | ⬜ | Not started. |
| F-15 | Share episode link | ⬜ | Not started. Needs public web episode pages. |

P1 and P2 items (F-16 to F-27) are not started, as planned. The feed parser already extracts `chaptersUrl` and `transcriptUrl` for F-16.

## Platform / infrastructure

| Item | Status | Notes |
| --- | --- | --- |
| Monorepo (pnpm + Turbo) | ✅ | |
| Shared models + rules | ✅ | Unit-tested |
| Lenient feed parser | ✅ | One fixture. The spec wants a 500-feed snapshot corpus. |
| API: resolve feed, podcast, episodes | ✅ | In-memory store only |
| Safe feed fetching (SSRF guard, ETag) | ✅ | |
| `AudioPlayer` native + web | ✅ | Background playback config and lock screen via expo-audio; Media Session on web |
| Local persistence | ✅ | Zustand `persist` over a key-value store: IndexedDB on web, `expo-sqlite/kv-store` on native (`src/storage/`). Library and player state (subscriptions, queue, positions, played, speed) survive reloads; verified in a browser. Not a relational DB yet; revisit when sync needs an outbox. |
| PostgreSQL `CatalogStore` | ⬜ | Interface ready in `apps/api/src/store.ts` |
| Feed worker (adaptive polling, WebSub) | ⬜ | `apps/feed-worker` doesn't exist yet |
| Redis, object storage / CDN | ⬜ | |
| Settings screen, onboarding, `/episode/[id]` route | ⬜ | Spec routes not yet built |
| Wide-screen layout (sidebar + right-hand player at >1024 px) | ⬜ | |
| i18n (i18next, EN + ES), web keyboard shortcuts | ⬜ | |
| Component tests, Maestro, Playwright E2E | ⬜ | Web flows (persistence, seeking, tab bar, Discover) were checked with throwaway headless-browser scripts, not a committed suite |
| CI (lint, typecheck, tests, EAS preview builds) | ⬜ | |
| Sentry, analytics | ⬜ | |
| Git repo at `podcast-app/` | ✅ | The nested `apps/client/.git` was removed and the client committed into the main repo (`17a1a8f`). |
| Real bundle id / package name | ⬜ | `com.example.podcast` is a placeholder |
| Real `User-Agent` contact URL | ⬜ | `PodcastApp/0.1 (+https://example.com/bot)` in `apps/api/src/fetch-feed.ts` |

## Suggested next steps

1. ~~Initialize git at `podcast-app/` and remove the nested `apps/client/.git`.~~ Done.
2. Get a Podcast Index key (https://api.podcastindex.org/signup), put it in `apps/api/.env` (see `.env.example`), and check search and charts against the real service.
3. Run the slice on an iOS simulator and an Android emulator to confirm background audio and lock-screen controls. This is the spec's phase-1 "audio spike" gate.
4. ~~Add local persistence for the player and library stores.~~ Done (key-value; see above).
5. Postgres `CatalogStore` plus a feed worker with adaptive polling.
6. ~~Podcast Index integration for search (F-02) and trending (F-01).~~ Built; needs the key (step 2).
7. Sleep timer (F-14), downloads (F-10) and OPML (F-03).
8. Auth, then the sync outbox and `/v1/sync` (F-12, F-13).

## Open questions (from the spec)

- Business model: free, freemium (sync and effects behind a subscription), or listener-supported?
- Build our own catalog search index, or rely on Podcast Index search at launch?
- Web offline listening via a service worker in v1.x?
- Launch markets and languages beyond English and Spanish?
- A desktop app (Electron or Tauri wrapper), or is the browser enough?
- Native audio library: stay on `expo-audio` (2x cap) or move to `react-native-track-player` as the spec originally said? *(Raised by the build, not discussed with Rob.)*
