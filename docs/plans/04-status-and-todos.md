# Status and open TODOs

Checked against the code on 2026-10-01. Legend: ✅ done · 🟡 partial · ⬜ not started.

## v1 (P0) features

| ID | Feature | Status | Where / what's missing |
| --- | --- | --- | --- |
| F-01 | Discovery (Podcast Index trending + categories) | ⬜ | `discover.tsx` shows a hard-coded "Try these" list. There's no Podcast Index client and no `/v1/discover`. |
| F-02 | Search | ⬜ | No `/v1/search`, no search UI. |
| F-03 | Subscribe (search, show page, RSS URL) + OPML | 🟡 | Add by RSS URL works (`POST /v1/podcasts/resolve`), and subscribe/unsubscribe works (`library/store.ts`). Missing: OPML import/export and persistence. |
| F-04 | Show page | 🟡 | `podcast/[id].tsx` has artwork, paged episodes and "Play latest". Missing: a sort toggle in the UI (the API supports it) and season grouping. |
| F-05 | Episode page / show notes | 🟡 | Episode rows show notes as plain text (`htmlToText`). Missing: an `/episode/[id]` route, sanitized HTML rendering, and tappable timestamps. |
| F-06 | Playback | 🟡 | Play, pause, seek, skip 15/30 s and speed presets work. Missing: configurable skip intervals in settings and 0.1 speed steps in the UI. Native speed is capped at 2.0x by expo-audio. |
| F-07 | Queue | 🟡 | Play next, play last, auto-advance, remove, and move up/down buttons work. Missing: drag to reorder and swipe to remove. |
| F-08 | Resume | 🟡 | Position is saved every 10 s, on pause and on seek, but only in memory. Missing: persistence, saving on app background, and cross-device resume (needs sync). |
| F-09 | Played state | 🟡 | Auto-mark at 95% or fewer than 30 s left works, and `setPlayed` exists. Missing: a manual mark played/unplayed control (`setPlayed` exists in the store but nothing in the UI calls it), and persistence. |
| F-10 | Downloads (mobile) | ⬜ | Not started. Needs a `DownloadManager` interface and expo-file-system. |
| F-11 | Home "New" section | 🟡 | Built in `(tabs)/index.tsx` from `lastHomeVisitAt`. Missing: the unplayed badge on the tab, and persistence of the last visit time. |
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
| Local database (SQLite / IndexedDB) | ⬜ | **Highest-priority gap:** all client state is lost on reload |
| PostgreSQL `CatalogStore` | ⬜ | Interface ready in `apps/api/src/store.ts` |
| Feed worker (adaptive polling, WebSub) | ⬜ | `apps/feed-worker` doesn't exist yet |
| Redis, object storage / CDN | ⬜ | |
| Settings screen, onboarding, `/episode/[id]` route | ⬜ | Spec routes not yet built |
| Wide-screen layout (sidebar + right-hand player at >1024 px) | ⬜ | |
| i18n (i18next, EN + ES), web keyboard shortcuts | ⬜ | |
| Component tests, Maestro, Playwright E2E | ⬜ | No browser was available in the session to run Playwright |
| CI (lint, typecheck, tests, EAS preview builds) | ⬜ | |
| Sentry, analytics | ⬜ | |
| Git repo at `podcast-app/` | ⬜ | Not initialized. `apps/client/.git` is a nested template repo to remove or fold in. |
| Real bundle id / package name | ⬜ | `com.example.podcast` is a placeholder |
| Real `User-Agent` contact URL | ⬜ | `PodcastApp/0.1 (+https://example.com/bot)` in `apps/api/src/fetch-feed.ts` |

## Suggested next steps

1. Initialize git at `podcast-app/` and remove the nested `apps/client/.git`.
2. Run the slice on an iOS simulator and an Android emulator to confirm background audio and lock-screen controls. This is the spec's phase-1 "audio spike" gate.
3. Add local persistence for the player and library stores (expo-sqlite + Drizzle on native, IndexedDB on web, behind a `Storage` interface).
4. Postgres `CatalogStore` plus a feed worker with adaptive polling.
5. Podcast Index integration for search (F-02) and trending (F-01).
6. Sleep timer (F-14), downloads (F-10) and OPML (F-03).
7. Auth, then the sync outbox and `/v1/sync` (F-12, F-13).

## Open questions (from the spec)

- Business model: free, freemium (sync and effects behind a subscription), or listener-supported?
- Build our own catalog search index, or rely on Podcast Index search at launch?
- Web offline listening via a service worker in v1.x?
- Launch markets and languages beyond English and Spanish?
- A desktop app (Electron or Tauri wrapper), or is the browser enough?
- Native audio library: stay on `expo-audio` (2x cap) or move to `react-native-track-player` as the spec originally said? *(Raised by the build, not discussed with Rob.)*
