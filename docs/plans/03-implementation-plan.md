# Implementation plan and build decisions

The plan the session followed after "let's start implementing", and the technical choices it made along the way. Where the code differs from the spec, it's called out here.

## Approach

Build a thin vertical slice first: **add a feed by RSS URL, then browse it, play it, queue it and resume it** on iOS, Android and web. Accounts, sync, the database, search and downloads come after. This matches the spec's Foundations and Core MVP phases, but uses in-memory storage so the whole loop runs locally.

## Repo layout (pnpm workspaces + Turborepo)

| Path | Package | What it is |
| --- | --- | --- |
| `apps/client` | `@podcast/client` | Expo app (SDK 57, Expo Router, `src/` layout), iOS + Android + web |
| `apps/api` | `@podcast/api` | Fastify REST API (TypeScript, run with `tsx`) |
| `packages/shared` | `@podcast/shared` | Zod models, sync merge rules, playback rules, fractional queue keys |
| `packages/feed-parser` | `@podcast/feed-parser` | Lenient RSS parser on `fast-xml-parser` |

- Workspace packages are consumed as TypeScript source (`main: src/index.ts`), with no build step.
- `pnpm-workspace.yaml` allows the `esbuild` build script (`onlyBuiltDependencies`).
- Root scripts: `pnpm dev:api`, `pnpm dev:client`, `pnpm test`, `pnpm typecheck`, `pnpm lint`. Turbo runs typecheck before test.
- The spec's `apps/feed-worker` has **not** been created yet. Feed fetching currently happens inline in the API.

## Decisions that differ from the spec

| Spec says | Built | Why / consequence |
| --- | --- | --- |
| `react-native-track-player` for native audio | **`expo-audio`** (first-party Expo module, with background playback and lock-screen controls via `setActiveForLockScreen`) | Inferred from the session's checks of library versions and release recency; the session didn't state a reason. Consequence: native speed is capped at **2.0x** (`NATIVE_MAX_RATE`). Web supports up to 3.0x. Revisit if 3x on mobile or richer remote commands matter. |
| Interface `setQueue`, `onEvent(...)` | `AudioPlayer` has `load / play / pause / seekTo / setRate / setSkipIntervals / onEvent`, plus `maxRate`. The queue lives in the Zustand store, not the player. | Simpler, and keeps queue logic shared across platforms. |
| SQLite (expo-sqlite + Drizzle) / IndexedDB local DB | Zustand `persist` over a key-value store (`expo-sqlite/kv-store` on native, IndexedDB on web) | Simpler than a relational schema while all state is per-device. Revisit for the sync outbox. |
| Postgres + Redis | `PostgresCatalogStore` (the `postgres` npm client, plain SQL migrations); `InMemoryCatalogStore` when no `DATABASE_URL` is set. No Redis yet. | Search and chart responses are cached in process memory rather than Redis. |
| Mini player / tabs | NativeTabs (`expo-router/unstable-native-tabs`) on native; custom `expo-router/ui` tabs plus a bottom web player bar on web | |
| Icons | `expo-symbols` `SymbolView`: SF Symbols on iOS, Material Symbols on Android and web | |

## What each package does today

**`packages/shared`**
- Zod schemas: `Podcast`, `Episode`, `Subscription`, `EpisodeState`, `QueueItem`, `Settings` (+ `DEFAULT_SETTINGS`), `ResolveFeedRequest`.
- Playback rules: `MIN_RATE` 0.5, `MAX_RATE` 3, `RATE_STEP` 0.1, `NATIVE_MAX_RATE` 2, `clampRate`, `shouldMarkPlayed` (95% or fewer than 30 s left), `POSITION_SAVE_INTERVAL_MS` 10 s.
- Sync merge: `mergeEpisodeState` (latest write wins; a write within `CONCURRENT_WINDOW_MS` 2 s counts as concurrent, so the furthest position wins), `mergeOnSignIn` (furthest position, played sticks), `lastWriteWins`, `SyncChange` type.
- Queue: fractional-index sort keys (`sortKeyBetween/After/Before`), so a reorder syncs as one row.

**`packages/feed-parser`**
- `parseFeed`, `parseDuration` and `FeedParseError`. Reads iTunes, `content:encoded` and `podcast:` namespace fields (`transcriptUrl`, `chaptersUrl`, season, episode number). Tested against a fixture feed.

**`apps/api`** (port 4000, `CORS_ORIGINS` env)
- `GET /health`
- `POST /v1/podcasts/resolve`: add by RSS URL. The URL is normalized (`feed://` upgraded to https, hash stripped) and the feed is fetched once and cached.
- `GET /v1/podcasts/:id`, `GET /v1/podcasts/:id/episodes?cursor&limit&sort=newest|oldest`
- Feed fetching (`fetch-feed.ts`): SSRF guard (blocks private and loopback IPs on every redirect hop), 15 s timeout, 20 MB cap, max 5 redirects, conditional `ETag` / `If-Modified-Since`, app `User-Agent`.
- Stable ids: `pod_` + hash(feedUrl), `ep_` + hash(podcastId, guid).
- Error codes: `invalid_request`, `invalid_feed_url`, `feed_unreachable`, `feed_invalid` (422), `invalid_url`, `not_found`.

**`apps/client`**
- Routes: `(tabs)/index` (Home: Continue listening + "New" since last visit), `(tabs)/discover` (add by RSS URL + "Try these" sample feeds), `(tabs)/library` (subscriptions), `(tabs)/queue` (Up Next with move up/down and remove), `podcast/[id]` (show page, paged episodes, subscribe, "Play latest"), `player` (full player).
- `src/player/`: `AudioPlayer` interface with `.native.ts` (expo-audio) and `.web.ts` (HTML5 audio + Media Session) implementations. `store.ts` holds the Zustand player store (resume, auto-mark played, auto-advance, rate presets, skip 15/30 s, play next / play last).
- `src/library/store.ts` holds subscriptions and `lastHomeVisitAt`.
- `src/api/client.ts`: `EXPO_PUBLIC_API_URL`, which defaults to `localhost:4000`, or `10.0.2.2:4000` on the Android emulator.
- `app.json`: name "Podcast", scheme `podcast`, bundle id / package `com.example.podcast` (placeholder), expo-audio plugin with background playback on.

## Verification done in the session

- 34 unit tests across shared, feed-parser and api passed, and every package typechecked.
- A live API check against a real feed from `feeds.yaml`. This turned up an error-code fix: `invalid_feed_url` vs `feed_unreachable`.
- Client: `tsc --noEmit` and `expo lint` pass. One template lint error in `use-color-scheme.web.ts` was fixed.
- No browser was available for Playwright, so web was checked by fetching server-rendered HTML for `/`, `/discover`, `/library`, `/queue` and a show page. All rendered.
- **Not done:** an end-to-end click-through on web, and any run on an iOS simulator, Android emulator or real device.
- The session's last step was a workspace-wide `pnpm typecheck` / `pnpm test` through Turbo and adding a root README. It was mid-run when these docs were written.

## Housekeeping notes

- `podcast-app/` is **not a git repository**. `apps/client/` contains its own nested `.git` created by `create-expo-app`. Before the first commit, decide whether to delete `apps/client/.git` and run `git init` at `podcast-app/`.
- The template added `apps/client/CLAUDE.md`, `AGENTS.md` and `.claude/settings.json`. `AGENTS.md` says to check the Expo SDK 57 docs rather than memory, and to run typecheck and lint after changes.
