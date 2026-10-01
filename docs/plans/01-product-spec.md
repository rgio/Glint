<!--
Snapshot of the living spec, exported 2026-10-01 (doc revision 24) from
https://claude.ai/code/artifact/87e6afa3-a9ab-49ce-9d09-11f69cb6ad30
The two diagrams (architecture, roadmap) are transcribed as text.
If the doc and this file disagree, the doc is newer unless this file was edited after the export.
For what is actually built, see 04-status-and-todos.md.
-->

# Podcast App — Cross-Platform Product & Technical Specification

Oct 1, 2026 · @Rob

## Overview

We will build one podcast app, from one TypeScript codebase, that ships to the App Store, Google Play and the web. It lets listeners find shows, subscribe, and play episodes reliably online or offline, with their library and listening position synced across every device.

**Goals**

- One codebase, at least 90% shared code across iOS, Android and web; platform-specific code is isolated behind interfaces.
- Playback that never loses the listener's place: background audio, lock-screen controls, resume to the second on any device.
- Offline-first on mobile: downloaded episodes and the library work with no network.
- Open ecosystem: any public RSS feed can be added, plus a searchable catalog via the Podcast Index API.

**Non-goals for v1**

- Hosting or publishing podcasts (we are a listening client, not a host).
- Video podcasts, live audio, and social features (comments, follows).
- Paid subscriptions to private feeds (planned for v2; private RSS URLs are supported in v1).

**Target users**

| Persona | Need | What wins them |
| --- | --- | --- |
| Commuter | Hands-free listening in the car or on transit | Offline downloads, sleep timer (car support later) |
| Power listener (20+ subscriptions) | Manage a large queue efficiently | Filters, playlists, variable speed, silence trimming |
| Desk listener | Listen at work on a laptop | Full web player, keyboard shortcuts, cross-device sync |
| Casual listener | Find something good fast | Curated discovery, search, one-tap play |

**Success metrics (first 6 months after launch)**

- Crash-free sessions at or above 99.5% on both mobile platforms.
- Playback start time under 1.5 s (p75) for streamed episodes on 4G.
- Day-30 retention of 30% or more.
- Store rating of 4.5 or higher.

## Platform and technology choice

**Decision: React Native with Expo (TypeScript), using Expo Router and React Native Web to produce the iOS, Android and web apps from one project.** It gives us a real DOM on the web (accessibility, SEO for public show pages, normal URLs), mature native audio libraries, and over-the-air updates for JS fixes.

| Option | Web output | Background audio on mobile | Shared code | Verdict |
| --- | --- | --- | --- | --- |
| React Native + Expo + RN Web | Real DOM, SSR/static pages possible, crawlable | Strong (react-native-track-player) | High; web player is a separate adapter | **Chosen** |
| Flutter | Canvas rendering; weaker SEO and screen-reader support | Strong (just\_audio + audio\_service) | Very high | Runner-up; pick if the team is Dart-first |
| Kotlin Multiplatform + Compose MP | Web target still maturing | Strong, but more native glue | Logic high, UI medium | Not chosen |
| Capacitor / Ionic (web-first) | Excellent | Weakest; needs native plugins for reliable background playback | Very high | Not chosen |

**Stack**

| Concern | Choice |
| --- | --- |
| Language | TypeScript (strict mode) |
| App framework | Expo (managed workflow with config plugins; custom dev client) |
| Navigation & routing | Expo Router (file-based; deep links and web URLs from the same routes) |
| UI | React Native primitives + a small in-house component library; Tamagui or NativeWind for styling tokens |
| Server state | TanStack Query (caching, retries, background refetch) |
| Client state | Zustand (player state, UI state) |
| Local database | SQLite via expo-sqlite + Drizzle ORM on mobile; IndexedDB (via the same repository interface) on web |
| Audio | react-native-track-player on iOS/Android; HTML5 audio + Media Session API on web, behind one `AudioPlayer` interface |
| Downloads | expo-file-system background downloads on mobile; web is streaming-only in v1 |
| Auth | Sign in with Apple, Google, and email magic link |
| Backend | Node.js (TypeScript) services, PostgreSQL, Redis, object storage + CDN for artwork |
| Monorepo | pnpm workspaces + Turborepo: `apps/client`, `apps/api`, `apps/feed-worker`, `packages/shared` (types, validation with Zod) |

**Rule for platform code:** shared screens import only interfaces (`AudioPlayer`, `DownloadManager`, `Storage`). Implementations live in `*.native.ts` and `*.web.ts` files, which the bundler picks per platform.

## Functional requirements

P0 ships in v1.0, P1 in v1.x, P2 is later. v1 scope was cut to the core listening loop: push notifications and CarPlay / Android Auto are out, sync is pull-based, and chapters, transcripts and curation move to v1.x. "All" means iOS, Android and web unless a platform is named.

| ID | Area | Requirement | Priority | Platforms |
| --- | --- | --- | --- | --- |
| F-01 | Discovery | Browse categories and trending charts sourced from the Podcast Index API; no editorial curation in v1 | P0 | All |
| F-02 | Search | Full-text search over shows and episodes (title, author, description) with results in under 500 ms p75 | P0 | All |
| F-03 | Subscribe | Subscribe/unsubscribe from search, show page, or by pasting an RSS URL; OPML import and export | P0 | All |
| F-04 | Show page | Artwork, description, episode list (sort newest/oldest), season grouping, "Play latest" | P0 | All |
| F-05 | Episode page | Show notes rendered as sanitized HTML; timestamps in notes tap to seek | P0 | All |
| F-06 | Playback | Play, pause, seek, skip back/forward (configurable 10/15/30 s), one global speed 0.5x to 3.0x in 0.1 steps | P0 | All |
| F-07 | Queue | "Up Next" queue: play next, play last, drag to reorder, swipe to remove, auto-advance | P0 | All |
| F-08 | Resume | Save position every 10 s and on pause; resume on any device signed into the same account after its next sync | P0 | All |
| F-09 | Played state | Mark played/unplayed; auto-mark played at 95% or when fewer than 30 s remain | P0 | All |
| F-10 | Downloads | Manual download, auto-download the latest episode per show, Wi-Fi-only toggle, auto-delete after played | P0 | iOS, Android |
| F-11 | Home "New" section | New episodes from subscriptions since the last visit, with an unplayed badge on the tab (replaces push in v1) | P0 | All |
| F-12 | Accounts | Optional account; app is fully usable signed out with local-only data; on sign-in, subscriptions are combined and the furthest position wins | P0 | All |
| F-13 | Sync | Subscriptions, queue, positions, played state and settings sync on app launch, on return to foreground, on pause, and every 60 s during playback | P0 | All |
| F-14 | Sleep timer | 5/15/30/60 min or end of episode; fade out the last 10 s | P0 | All |
| F-15 | Share | Share an episode link that opens its public web page with a play button | P0 | All |
| F-16 | Chapters & transcripts | `podcast:chapters`, ID3 chapters and `podcast:transcript`, with chapter skip and searchable transcripts | P1 | All |
| F-17 | Download controls | Storage limit, auto-download newest N per show, per-show speed override | P1 | iOS, Android |
| F-18 | Audio effects | Silence trimming and voice boost | P1 | iOS, Android |
| F-19 | Filters & playlists | Smart playlists by rule (e.g. unplayed, under 30 min, from selected shows) | P1 | All |
| F-20 | Widgets | Home-screen widget with now playing and Up Next | P1 | iOS, Android |
| F-21 | Clips | Share a link at a timestamp; the web page plays from that point | P1 | All |
| F-22 | Podcasting 2.0 | Other `podcast:` namespace tags: funding, persons, value-for-value display | P1 | All |
| F-23 | Curation | Editor picks and curated rows on Discover | P1 | All |
| F-24 | Push notifications | New-episode alerts with per-show toggle (APNs, FCM, Web Push) | P2 | All |
| F-25 | Car | CarPlay and Android Auto browsing and playback | P2 | iOS, Android |
| F-26 | Watch | Apple Watch and Wear OS remote and offline playback | P2 | Watch OS |
| F-27 | Stats | Personal listening stats (hours listened, time saved by speed and trimming) | P2 | All |

**Key behaviors**

- **Conflict rule for sync:** the most recent write wins per field, using a client timestamp plus a server-assigned version; playback position uses the furthest-recent update so a stale device never rewinds the listener.
- **Signed-out data** lives only on the device. On first sign-in the app uploads it: subscriptions are combined, and for each episode the furthest position and any played mark are kept. No other field-level merging in v1.
- **Feed refresh:** the server polls feeds; the client pulls new episodes as part of each sync and on pull-to-refresh. The client never polls third-party feeds directly on mobile, to save battery and data.

## Audio playback engine

Playback is the product, so it gets one shared `AudioPlayer` interface with a native and a web implementation, and a single player store that the UI reads from. No screen talks to an audio library directly.

```typescript
interface AudioPlayer {
  load(episode: EpisodeSource, startAt?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  setRate(rate: number): Promise<void>;          // 0.5 to 3.0, pitch-corrected
  setQueue(items: EpisodeSource[]): Promise<void>;
  onEvent(cb: (e: PlayerEvent) => void): Unsubscribe; // progress, ended, error, remote-command
}
```

| Capability | iOS | Android | Web |
| --- | --- | --- | --- |
| Library | react-native-track-player (AVPlayer) | react-native-track-player (Media3 ExoPlayer) | HTML5 `<audio>` element |
| Background audio | `audio` background mode, AVAudioSession category playback | Foreground service with media notification | Plays while the tab is open; mobile browsers may suspend it |
| Lock screen / system controls | Now Playing info + remote commands | MediaSession notification | Media Session API (play, pause, seek, artwork) |
| Headphones & Bluetooth | Remote commands, pause on route change | Pause on "becoming noisy" | Media Session actions where the browser supports them |
| Interruptions (calls, other apps) | Pause and resume per interruption type | Audio focus: duck or pause | Not applicable |
| Car | CarPlay audio app template (P2) | Android Auto media browser service (P2) | Not applicable |
| Offline file playback | Local file URI | Local file URI | Not in v1 |

**Rules**

- **Chapters** come from `podcast:chapters` JSON or embedded ID3 chapters; the player exposes the current chapter and next/previous chapter commands.
- **Speed** is global in v1 (per-show override in v1.x), and pitch is always corrected.
- **Position persistence:** write to local DB every 10 s, on pause, on seek, and when the app goes to background; queue a sync event each time.
- **Streaming:** use the enclosure URL as-is, follow redirects (analytics prefixes are common), and send a `User-Agent` that identifies the app so hosts can count downloads per the IAB guidelines.
- **Errors:** on a stream failure, retry twice with backoff, then show an inline error with "Retry" and "Download instead" (mobile).
- **Silence trimming and voice boost (P1)** need native audio processing; build them as a custom Expo module on top of the platform players rather than in JavaScript.

## Architecture

The client is layered so that screens and state never touch platform APIs; only the bottom adapter layer differs between iOS, Android and web. The backend owns feed ingestion and sync, while audio is streamed or downloaded straight from each podcast's host.

*Architecture diagram (transcribed from the doc):*

```
Client app · apps/client · iOS, Android and web
  Screens and components   Expo Router routes and shared UI, same code on every platform
  State                    Zustand for player and UI state · TanStack Query for server data
  Service interfaces       AudioPlayer · DownloadManager · Storage · SyncEngine
  Adapters
    iOS      AVPlayer · SQLite · Keychain · CarPlay (later)
    Android  Media3 ExoPlayer · SQLite · Keystore · Android Auto (later)
    Web      HTML5 audio · Media Session API · IndexedDB
        |  REST + sync over HTTPS (client pulls)
Backend · Node.js services
  REST API        auth · search · sync · subscriptions · OPML
  Push service    not in v1
  Feed worker     polls RSS with ETag, parses, dedupes
  PostgreSQL      catalog + user state
  Redis           cache · job queues
  Object storage  artwork via CDN
External
  Podcast audio hosts (MP3/AAC enclosures, streamed or downloaded)
  Public RSS feeds (any podcast host)
  Podcast Index API (catalog seed)
```

Read top to bottom: screens call state, state calls the service interfaces, and each platform supplies its own adapter.

**Offline-first client data flow**

1. Screens read from the local database through repositories, so they render instantly with no network.
2. Every user action writes locally first, then appends to the sync outbox.
3. The SyncEngine drains the outbox and pulls remote changes, updating the local database, which re-renders the screens.

**Feed ingestion**

- The feed worker polls each feed on an adaptive schedule: every 15 min for shows that publish daily, down to every 24 h for inactive shows; WebSub pushes are used when a feed advertises a hub.
- Conditional requests (`ETag`, `If-Modified-Since`) skip unchanged feeds; episodes are de-duplicated by `guid`, falling back to enclosure URL.
- New episodes reach devices on their next sync and appear in the Home "New" section.
- The catalog is seeded from the Podcast Index API and grows as users add RSS URLs.

## Data model and API contract

The catalog (podcasts, episodes) is global and read-only to clients; everything a listener does is per-user state that syncs. Types live in `packages/shared` and are validated with Zod on both client and server.

**Core entities**

| Entity | Key fields | Scope |
| --- | --- | --- |
| Podcast | id, feedUrl, title, author, description, artworkUrl, language, categories\[\], explicit, lastPublishedAt, feedEtag | Global |
| Episode | id, podcastId, guid, title, publishedAt, durationSec, enclosureUrl, enclosureType, enclosureBytes, showNotesHtml, chaptersUrl, transcriptUrl, season, episodeNumber | Global |
| User | id, email, authProviders\[\], createdAt, locale | Per user |
| Subscription | userId, podcastId, subscribedAt, autoDownload, speedOverride (v1.x), updatedAt | Per user |
| EpisodeState | userId, episodeId, positionSec, played, playedAt, starred, updatedAt, version | Per user |
| QueueItem | userId, episodeId, sortKey (fractional index), addedAt | Per user |
| Settings | userId, skipBackSec, skipForwardSec, defaultSpeed, autoDeletePlayed, wifiOnlyDownloads, theme | Per user |
| Device | id, userId, platform, appVersion, lastSeenAt | Per user |
| Download (client only) | episodeId, localPath, bytes, status, downloadedAt | Per device |

**REST API (v1, JSON over HTTPS, `Authorization: Bearer <token>`)**

| Method & path | Purpose |
| --- | --- |
| `GET /v1/search?q=&type=show,episode&cursor=` | Search the catalog |
| `GET /v1/discover?section=top,category:{id}` | Charts and curated lists |
| `GET /v1/podcasts/{id}` | Show detail |
| `GET /v1/podcasts/{id}/episodes?cursor=&sort=` | Paged episode list |
| `POST /v1/podcasts/resolve` | Add by RSS URL; fetches and parses the feed if new |
| `GET /v1/me/subscriptions` · `PUT` · `DELETE /{podcastId}` | Manage subscriptions |
| `POST /v1/me/opml` · `GET /v1/me/opml` | Import / export OPML |
| `GET /v1/sync?since={cursor}` | Pull all user-state changes since a cursor |
| `POST /v1/sync` | Push a batch of changes (state, queue, subscriptions, settings) |
| `POST /v1/devices` | Register a device (push token added when push ships) |
| `GET /v1/feed-updates?since=` | New episodes for the user's subscriptions |

**Sync protocol**

1. The client records every user-state change in a local `outbox` table with a client timestamp.
2. When online, it sends the outbox in batches of up to 200 changes to `POST /v1/sync`; the server applies them per the conflict rules and returns the new cursor.
3. The client then calls `GET /v1/sync?since=cursor` to pull changes from other devices.
4. Other devices pull on launch, on return to foreground, on pause, and every 60 s during playback; v1 has no server-initiated push.

## UX, screens and accessibility

The app has four top-level destinations and a persistent mini-player. On phones they sit in a bottom tab bar; on tablets and web wider than 1024 px they move to a left sidebar, and the full player opens as a right-hand panel instead of a modal.

| Route (Expo Router) | Screen | Contents |
| --- | --- | --- |
| `/` | Home | Continue listening, new episodes from subscriptions, Up Next preview |
| `/discover` | Discover | Search bar, categories, top charts, curated rows |
| `/library` | Library | Subscriptions grid, Downloads, Starred, History, Playlists |
| `/queue` | Up Next | Reorderable queue |
| `/podcast/[id]` | Show | Header, subscribe, settings, episode list |
| `/episode/[id]` | Episode | Play, download, notes, chapters, transcript |
| `/player` | Full player | Artwork, scrubber, speed, sleep timer, chapters, share |
| `/settings` | Settings | Playback, downloads, notifications, account, OPML |
| `/onboarding` | Onboarding | Pick topics, import OPML, optional sign-in |

**Design system**

- Tokens for color, spacing (4 px grid), radius, and type, defined once and used on all three platforms; light and dark themes follow the OS by default.
- Dynamic color from podcast artwork on the full player, with a contrast check so text stays at 4.5:1 or better.
- Platform conventions where they matter: native share sheets, haptics on iOS and Android, back gestures, and hover and focus states on web.

**Accessibility (target WCAG 2.2 AA)**

- Every control has an accessible label; the scrubber announces elapsed and remaining time and supports increment and decrement actions.
- Respects Dynamic Type / font scaling up to 200% without clipping; respects Reduce Motion.
- Full keyboard support on web: space play/pause, arrow keys seek 10 s, `Shift` + `<` and `>` change speed, `/` focuses search.
- Minimum touch target 44 x 44 pt.
- Transcripts double as an accessibility feature and are searchable when available.

**Internationalization**

- All strings in ICU message format via i18next; launch languages English and Spanish, with right-to-left layout supported from day one.
- Dates, durations, and numbers formatted with `Intl` per locale; discovery content filtered by the user's region and language.

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| Startup | Cold start to interactive under 2 s on a mid-range Android phone (p75); web LCP under 2.5 s |
| Playback start | Under 1.5 s p75 on 4G for streams; under 300 ms for downloaded files |
| Scrolling | 60 fps on lists of 1,000+ episodes (FlashList, virtualized on web) |
| App size | Under 40 MB download on each store; web initial JS bundle under 300 KB gzipped |
| Battery | No client-side feed polling; downloads batched and constrained to charging + Wi-Fi when the user opts in |
| Offline | Library, queue, downloads, and played state fully usable offline; changes sync when back online |
| Availability | API 99.9% monthly; playback of downloaded episodes never depends on the API |
| Security | TLS 1.2+ everywhere; tokens in Keychain / Keystore (expo-secure-store) and HttpOnly cookies on web; short-lived access tokens with refresh rotation |
| Content safety | Show notes HTML sanitized with an allow-list before render; links open in the system browser |
| Privacy | Collect the minimum: no ad SDKs, no cross-app tracking; App Store privacy labels and Play data-safety form completed; GDPR/CCPA data export and account deletion in-app |
| Analytics | Privacy-respecting product analytics (e.g. PostHog, self-hosted), opt-out in settings; never log full listening history to third parties |
| Observability | Sentry for crashes and JS errors on all three platforms; OpenTelemetry tracing on the backend; alerts on error rate and feed-ingestion lag |
| Scale (year 1) | 500k users, 1M+ indexed shows, 2M feed polls per day |

## Testing, CI/CD and release

Every pull request runs the same checks for all three platforms, and a release is one tagged commit that produces the iOS build, the Android build, and the web deploy together.

**Testing**

| Layer | Tooling | What it covers |
| --- | --- | --- |
| Unit | Jest / Vitest | Feed parsing, sync conflict rules, queue ordering, reducers |
| Component | React Native Testing Library | Screens and components with mocked `AudioPlayer` |
| End-to-end, mobile | Maestro on iOS simulator and Android emulator | Subscribe, play, background, resume, download, offline mode |
| End-to-end, web | Playwright | Search, play, keyboard shortcuts, shared-timestamp links |
| Feed corpus | Snapshot tests over 500 real-world RSS feeds | Parser robustness against malformed feeds |
| Manual device matrix | 2 iPhones, 1 iPad, 3 Android phones (incl. one low-end) | Audio focus, Bluetooth, lock screen |

**Pipeline**

1. Pull request: lint (ESLint), typecheck (tsc), unit + component tests, web build, and EAS preview builds with a QR code for testers.
2. Merge to `main`: deploy web to staging; build internal TestFlight and Play internal-track builds.
3. Release tag: EAS Build produces store builds; EAS Submit uploads to App Store Connect and Google Play; web deploys to production behind a CDN.
4. JS-only fixes ship through EAS Update (over-the-air) within store rules; anything touching native code goes through a store release.

**Release policy**

- Two-week release train; staged rollout on Play (10%, 50%, 100%) and phased release on the App Store.
- Feature flags for anything risky, so it can be turned off without a release.
- Rollback rule: crash-free sessions dropping below 99.3% on a rollout pauses it automatically.

## Roadmap, risks and open questions

v1.0 is planned at about 20 weeks (down from 24 after the scope cuts) for a team of 3 client engineers, 2 backend engineers, 1 designer and 1 QA engineer. Week counts are estimates, not to scale; no calendar dates are set yet.

*Roadmap diagram (transcribed from the doc): v1.0 ships in about 20 weeks, gated on a three-platform playback spike.*

| Phase | Weeks | Work | Gate to next phase |
| --- | --- | --- | --- |
| Foundations | 1 to 4 | Monorepo + CI, design tokens, audio spike on all 3 platforms, feed worker + DB, auth | Background playback works on all 3 |
| Core MVP | 5 to 12 | Discover + search, subscribe + OPML, player + queue, accounts + sync, web player | Internal dogfood: all P0 flows pass |
| Mobile complete | 13 to 16 | Downloads + offline, share links, sleep timer, accessibility pass, public beta | Beta crash-free sessions 99.5%+ |
| Launch | 17 to 20 | Store review, staged rollout, web launch, show pages for SEO, perf + crash fixes | v1.0 GA |

After launch: v1.x releases every two weeks (P1): chapters + transcripts, timestamp clips, smart playlists, widgets, silence trimming, curation.

Each phase starts only when the gate before it passes; the playback spike in weeks 1 to 4 is the main de-risking step for the single-codebase approach.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Background audio behaves differently across OS versions and OEM Android builds | High: lost playback breaks trust | Spike in phase 1; test on low-end and OEM-skinned devices; foreground service done by the book |
| Mobile web browsers suspend audio in background tabs | Medium: web listeners on phones get cut off | Position web as a desktop-first player; prompt phone users to install the app |
| App Store review rejects for minimum-functionality or OTA update rules | Medium: launch slip | Keep OTA updates to JS bug fixes; submit a beta build early in phase 3 |
| Malformed RSS feeds | Medium: missing episodes | Lenient parser plus the 500-feed snapshot corpus |
| Sync conflicts lose a listener's position | High | Position never moves backward from a stale device; property tests on merge rules |
| Native audio effects (silence trim) are costly to build | Low for v1 | Kept at P1; custom Expo module after launch |

**Open questions**

- [ ] Business model: free, freemium (sync and effects behind a subscription), or listener-supported?
- [ ] Do we build our own catalog search index or rely on the Podcast Index API search at launch?
- [ ] Should the web app offer offline listening via a service worker in v1.x?
- [ ] Which markets and languages launch beyond English and Spanish?
- [ ] Do we need a desktop app (Electron or Tauri wrapper of the web app), or is the browser enough?
