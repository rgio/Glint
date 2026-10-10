# Data layer: transcripts, highlights and discovery

Draft 1 · 9 October 2026 · for iterating with Rob. Stages A to E are built on the `data-layer` branch (see "What's built").

## Summary

This plan adds a content and data layer to the app, in four stages:

1. Fetch and store transcripts, with dLogos as the main source.
2. Make highlights and notes into data the server can query.
3. Embed highlights, notes and selected parts of transcripts.
4. Use those embeddings to recommend episodes.

Highlights phase 2 ("words attached", in [05-highlights-spec.md](05-highlights-spec.md)) is the first thing built on it. Discovery comes last.

**What this plan proposes:**

- **Use one stack: PostgreSQL with pgvector, written in TypeScript in this monorepo.** Retire the Python prototype (Flask, Chroma, `podcast_ingest`) once its useful parts are ported. Keeping vectors in the same database as users, highlights and the catalog gives us joins, deletes in one transaction (which privacy needs), and one thing to back up and host. A `VectorIndex` interface keeps a later move to a dedicated store such as Qdrant cheap. "Vector storage" below sets out the reasoning and the measured triggers for switching.
- **Make dLogos the main transcript source, with publisher transcripts as the fallback.** This reverses the order in the highlights spec. dLogos returns one consistent shape for every show: timed segments, speakers, chapters and takeaways. Discovery needs that consistency more than it needs the exact wording a publisher transcript gives.
- **Work jobs from a queue table in Postgres** (transcript requests, polling, chunking, embedding). Use the same `for update skip locked` lease pattern the feed worker already uses. Don't add Redis yet.
- **Store derived data apart from authored data.** A highlight's range and note are written by the listener and synced. Its transcript excerpt, chapter and embedding are worked out on the server from the range plus the transcript, so they can be recomputed at any time.
- **Pick what to embed for relevance and to keep the index small, not to save money on embedding.** Embedding a whole episode costs a fraction of a cent. The real limits are dLogos quota and index size (see Embeddings).

## What's built

All five stages are built on the `data-layer` branch, behind settings that are off by default: no dLogos key means publisher transcripts only, and `EMBEDDINGS_PROVIDER=off` means no vectors or recommendations. What exists:

- **Packages and processes.** `packages/content` holds the dLogos client, the publisher parsers, alignment and excerpts, the chunker, the embedders, `VectorIndex`, the job queue, discovery and the job handlers. `apps/content-worker` runs them, and has a CLI with `map-dlogos`, `request` and `eval`.
- **Migrations 006 to 009** (in `packages/catalog`, with the existing ones).
- **API:**
  - `GET /v1/episodes/:id/transcript/status`
  - `GET /v1/episodes/:id/transcript?start=&end=`
  - `GET /v1/me/highlights?q=&cursor=`
  - `GET /v1/me/recommendations` and `POST /v1/me/recommendations/events`
  - Sync enqueues transcript, excerpt and embedding jobs when a highlight changes.
- **Client.** Highlight cards show the excerpt, the chapter and an "approximate" note. A range edit clears the stale excerpt.
- **Not built:** a recommendations UI (the endpoint is ready), and the transcript view.

Where the build differs from the plan below:

| Plan | Built | Why |
| --- | --- | --- |
| Three alignment levels, with `aligned` from matching captured edges to segment boundaries | `exact` or `approximate` only. The approximate shift spreads the length difference evenly through the episode | dLogos segments run 10–18 s, so boundary matching can't tell offsets apart. `aligned` is kept for real evidence, e.g. an on-device fingerprint |
| Excerpt start snaps back to the sentence start within 5 s | Same, plus: if that fails, the start may move up to 3 s forward past the end of a sentence | Otherwise excerpts open with fragments like "…save it. Towns that…" |
| Separate vectors for the highlight and the note | One vector per highlight (excerpt, note and chapter). The `note` owner kind is reserved for standalone notes | Two vectors for one highlight counted it twice in the profile |
| Profiles rebuilt after 5 new highlights or daily | Rebuilt 5 minutes after the listener's last highlight vector changes (debounced by the job queue) | Simpler, and closer to real time |
| `episodes.dlogos_episode_id` | `transcripts.external_id` | Same information without a second copy |
| Migrations in `packages/content` | In `packages/catalog` with 001–005 | One migration sequence and one runner |
| Transcript text endpoint | Signed-in listeners only, at most 15 minutes per request | dLogos' terms on displaying transcripts aren't settled |
| Window gate: ±2 windows around highlights, subscribed shows, seeded set | All of an episode's windows when it's highlighted, its show has a subscriber, or it was seeded | Simpler. Revisit if index size grows (the switch triggers are logged) |

Also fixed along the way:

- **Postgres tests never ran under turbo.** Turbo's strict env mode hid `TEST_DATABASE_URL` from the test tasks, so the Postgres suites were skipped in CI too. `turbo.json` now passes it through, and `pnpm test` runs packages one at a time because their suites share one database.
- **dLogos paging.** The Python smoke test asked for `transcript_page=2` after the first page, but dLogos numbers pages from 0. The client now asks for the page after the one it got.

## What the review found

**The two codebases.** `podcast-app/` is the product: Expo client, Fastify API, Postgres, and a feed worker. The parent `podcast_test/` folder holds an earlier Python prototype:

- a Flask app with a Chroma vector store and OpenAI embeddings (`app/chroma.py`)
- a SQLite ingest pipeline that finds `podcast:transcript` tags (`podcast_ingest/`)
- the dLogos smoke test (`dlogos_test.py`) and its saved response (`data/dlogos/`)

The two share nothing at runtime.

**What exists today:**

| Area | State | Gap for this plan |
| --- | --- | --- |
| Catalog (`packages/catalog`, migrations 001–003) | `podcasts` and `episodes` in Postgres; the feed worker polls with leases | `transcriptUrl` and `chaptersUrl` are parsed (`feed-parser/src/index.ts:121`) but not stored. No link from our ids to dLogos ids |
| Highlights (migration 005) | `user_highlights(user_id, id, highlight jsonb, version)`, merged in the API | The whole highlight is one JSON blob, so we can't index, search or join on its range or episode |
| Highlight model (`shared/src/models.ts`) | `transcriptExcerpt` and `chapterTitle` are fields the client writes | Nothing on the server fills them. `mergeHighlight` keeps whichever excerpt came with the winning range, and `setRange` never clears it, so an excerpt goes stale once the range is edited |
| Jobs and async work | None. The feed worker is a single loop | dLogos is submit-then-poll and needs somewhere to run |
| Vectors | Chroma in the Python prototype only | Nothing in the product |
| Postgres | 16 in CI (`postgres:16`); hosting not chosen yet | pgvector needs the `pgvector/pgvector:pg16` image in CI and a host that supports the extension |

**What the dLogos sample shows** (*The Daily*, `data/dlogos/0b6c…json`):

- **Size:** 156 segments and about 5,900 words (about 8k tokens) for a 37-minute episode. A segment's median length is 13 s and the longest is 60 s.
- **Extras:** 8 chapters, 2 takeaways with topic tags (for example "Trade & Globalization"), and a speaker map. `detail.jobs` shows a `factcheck` job still running when the transcript was already `ready`. So readiness is per part, and claims can arrive later.
- **The timings don't match the reported duration.** dLogos reports `duration_seconds: 2221`, but its last segment ends at 2333 s, about 112 s later. The most likely cause is dynamically inserted ads: dLogos transcribed a copy of the audio with a different ad load than the one the duration came from. Listeners also hear their own ad load. So **a highlight's seconds can't be assumed to line up with dLogos' seconds**, and this has to be designed for from the start (see Lining up timings).

## Principles

1. **Postgres is the system of record.** Every vector, transcript and job lives in it. Large raw payloads can move to object storage later; the database keeps a pointer.
2. **The catalog and content are global; user data is private.** Transcripts, chunks and episode embeddings are shared by all users. Highlights, notes, their embeddings and interest profiles belong to one user, and are deleted with the account (`on delete cascade`).
3. **Derived data can always be rebuilt.** Each derived row records what it was built from (`transcript_id`, `model`, `chunker_version`), so we can recompute it with a new model, new chunking or a better transcript without migrating anything by hand.
4. **Interfaces with an in-memory version for tests**, like `CatalogStore`. `TranscriptSource`, `Embedder`, `VectorIndex` and `JobQueue` each get one, so the contract tests run with and without Postgres.
5. **Nothing about a listener goes to dLogos.** Requests carry only a public show slug and episode GUID (as the highlights spec already says). Text sent to the embedding provider is covered under Privacy.

## Architecture

```
            Expo client ──sync──▶ API (Fastify)
                                   │  reads: transcript ranges, highlight search, recommendations
                                   ▼
┌────────────────────────── PostgreSQL + pgvector ───────────────────────────┐
│ catalog      podcasts · episodes (+ transcript_url, chapters_url)          │
│ content      transcripts · transcript_segments · chapters · takeaways      │
│              dlogos_podcasts (our podcast ↔ dLogos slug)                   │
│ user         highlights (columns, not a blob) · notes                      │
│ derived      chunks · embeddings · user_interest_vectors · recs cache      │
│ ops          jobs (leased queue) · dlogos_usage                            │
└────────────────────────────────────────────────────────────────────────────┘
          ▲                                ▲
   feed-worker (exists)            content-worker (new)
   polls feeds                     dLogos submit/poll · publisher fetch ·
                                   chunk · embed · build profiles
```

**New code:**

- `packages/content`: the dLogos client, publisher transcript parsers (SRT, WebVTT, Podcasting 2.0 JSON), the chunker, the `Embedder` interface and its OpenAI implementation, the `VectorIndex` interface with a pgvector implementation, the job queue, and the store interfaces with Postgres and in-memory versions. Laid out like `packages/catalog`.
- `apps/content-worker`: claims jobs and runs them. A separate process from the feed worker, so slow dLogos polls and embedding batches never hold up feed polling. Same Docker image, a third command.

## Data model

Migration numbers continue from 005. Every table that needs it gets a `version` column so a change can sync, like the existing `user_*` tables.

### Catalog additions (006)

| Change | Why |
| --- | --- |
| `episodes.transcript_url`, `transcript_type`, `chapters_url` | The parser already extracts them; `toEpisodes` needs to pass them through |
| `dlogos_podcasts(podcast_id pk → podcasts, slug, dlogos_podcast_id, matched_by, confidence, checked_at)` | How we find a show at dLogos. `matched_by` is one of `manual`, `api_lookup`, `title_match` |
| `episodes.dlogos_episode_id` (nullable) | Set once dLogos has accepted the episode |

### Content (007)

```sql
create table transcripts (
  id uuid primary key,
  episode_id text not null references episodes (id) on delete cascade,
  source text not null,              -- 'dlogos' | 'publisher_srt' | 'publisher_vtt' | 'publisher_json'
  status text not null,              -- 'pending' | 'ready' | 'failed' | 'unavailable'
  language text,
  audio_duration_sec double precision, -- of the audio this transcript was made from (last segment end)
  reported_duration_sec double precision,
  audio_url text,                    -- the audio the source transcribed, for spotting a different ad load
  raw jsonb,                         -- the full response; can move to object storage later
  fetched_at timestamptz,
  error text,
  unique (episode_id, source)
);

create table transcript_segments (
  transcript_id uuid not null references transcripts (id) on delete cascade,
  idx integer not null,
  start_ms integer not null,
  end_ms integer not null,
  speaker text,
  text text not null,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  primary key (transcript_id, idx)
);
create index transcript_segments_time on transcript_segments (transcript_id, start_ms);
create index transcript_segments_tsv on transcript_segments using gin (tsv);

create table episode_chapters  (transcript_id uuid, position int, start_ms int, title text, primary key (transcript_id, position));
create table episode_takeaways (transcript_id uuid, position int, start_ms int, text text, tags text[], primary key (transcript_id, position));
```

**Which transcript an episode uses** is chosen when it's read, not stored: dLogos if it's ready, otherwise a timed publisher transcript. A view (`episode_transcript`) wraps that rule so every caller picks the same one. Keeping both sources means we can compare them, and fall back when dLogos is wrong (it does mishear speaker names: "Michael Bilbaro").

### Highlights and notes (008)

Change `user_highlights` from a JSON blob to columns, without changing the sync contract:

```sql
create table highlights (
  user_id uuid not null references users (id) on delete cascade,
  id uuid not null,
  episode_id text not null,
  podcast_id text not null,
  start_sec double precision not null,
  end_sec double precision not null,
  note text,
  source text not null,
  anchor_duration_sec double precision,
  anchor_enclosure_url text,
  created_at bigint not null, range_updated_at bigint not null, note_updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  note_tsv tsvector generated always as (to_tsvector('english', coalesce(note, ''))) stored,
  primary key (user_id, id)
);

-- Derived on the server; rebuilt whenever the range or the episode's transcript changes.
create table highlight_context (
  user_id uuid not null, highlight_id uuid not null,
  transcript_id uuid references transcripts (id) on delete set null,
  excerpt text, chapter_title text,
  offset_sec double precision,      -- the shift applied to line up with the transcript (see Lining up timings)
  confidence text,                  -- 'exact' | 'aligned' | 'approximate'
  for_range_updated_at bigint not null,  -- the range edit this was computed for
  primary key (user_id, highlight_id),
  foreign key (user_id, highlight_id) references highlights (user_id, id) on delete cascade
);
```

The migration copies the existing rows out of the JSON and drops `user_highlights`. The `Highlight` zod type and `POST /v1/sync` stay the same, except:

- **The excerpt and chapter become server-owned.** The server ignores `transcriptExcerpt` and `chapterTitle` when the client sends them. It fills them in when the client pulls, from `highlight_context`, and only if `for_range_updated_at` matches the highlight's current `rangeUpdatedAt`. A filled excerpt reaches other devices because the server bumps the highlight's `version`. This fixes the stale-excerpt problem in `mergeHighlight` and keeps the merge rules about what listeners write.
- **Notes stay attached to highlights for now** (see open question 1). If standalone notes come (on an episode or show, with no range), they get their own `notes` table with the same sync shape. Anything below that says "notes" covers both.

### Derived data and vectors (009, needs `create extension vector`)

```sql
create table transcript_chunks (
  id bigserial primary key,
  transcript_id uuid not null references transcripts (id) on delete cascade,
  chunker_version int not null,
  seg_from int not null, seg_to int not null,
  start_ms int not null, end_ms int not null,
  text text not null,
  kind text not null                  -- 'window' | 'chapter' | 'takeaway' | 'description'
);

-- One table for every embedding, keyed by what was embedded. Global and per-user rows live together
-- here so one index serves both; user rows carry user_id and are deleted with the account.
create table embeddings (
  id bigserial primary key,
  owner_kind text not null,           -- 'chunk' | 'episode' | 'highlight' | 'note' | 'profile'
  owner_id text not null,
  user_id uuid references users (id) on delete cascade,   -- null for global content
  episode_id text,                    -- denormalized for filtering
  model text not null,                -- e.g. 'text-embedding-3-small@512'
  input_hash text not null,           -- skip re-embedding text that hasn't changed
  vec halfvec(512) not null,
  created_at timestamptz not null default now(),
  unique (owner_kind, owner_id, model)
);
create index embeddings_vec on embeddings using hnsw (vec halfvec_cosine_ops) where user_id is null;
```

If per-user and global queries start getting in each other's way, split the table in two. Starting with one keeps the code simple.

### Jobs (006, with the catalog change)

```sql
create table jobs (
  id bigserial primary key,
  kind text not null,                 -- 'transcript.request' | 'transcript.poll' | 'transcript.publisher' | 'chunk' | 'embed' | 'highlight.context' | 'profile.rebuild'
  key text not null,                  -- e.g. the episode id; one live job per (kind, key)
  payload jsonb not null default '{}',
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  leased_until timestamptz,
  last_error text,
  done_at timestamptz
);
create unique index jobs_live on jobs (kind, key) where done_at is null;
create index jobs_due on jobs (run_at) where done_at is null;
```

Enqueueing is `insert … on conflict do nothing`, so calling it twice is harmless. Claiming copies `claimDueFeeds`. Polling dLogos is just a job that reschedules itself with backoff (`run_at = now() + interval`), so nothing ever sleeps while holding a lease. If this outgrows hand-written code, pg-boss uses the same model.

## Transcript pipeline (dLogos first)

**When an episode gets a transcript:**

| Trigger | Priority | Note |
| --- | --- | --- |
| The first highlight on an episode (by anyone) | High | As in the highlights spec; the listener is waiting on the excerpt |
| A listener opens the transcript view (F-16, later) | High | |
| Discovery corpus seeding (see Discovery) | Low, with a budget | The part that costs real dLogos quota; capped per day in `dlogos_usage` |

**Flow for one episode:**

1. `transcript.request` checks for a `ready` transcript and stops if there is one. Otherwise it looks up the show's dLogos slug.
   - No slug: try a publisher transcript (`transcript.publisher`), and record the show in a "needs mapping" list.
2. It sends `POST /api/v2/partner/episodes/process` with the slug and the episode GUID, then stores `dlogos_episode_id` and the poll URL.
3. `transcript.poll` runs at 30 s, then 1, 2, 5 and 10 min, giving up after a ceiling such as 2 h. When the status is `ready`:
   - it follows `transcript.has_more` pages (500 segments each)
   - writes `transcripts`, `transcript_segments`, chapters and takeaways in one transaction
   - enqueues `chunk` and a `highlight.context` for each highlight on the episode
4. If dLogos fails or doesn't cover the show, fall back to the publisher transcript. If there isn't one either, mark the episode `unavailable` and retry dLogos weekly. Coverage grows over time.
5. If dLogos finishes claims or factcheck later, a low-priority re-poll a day later picks them up. That only matters if we use claims.

**Finding a show's dLogos slug** is the main unknown. The slug looks like `the-daily-a12f141d`: a name plus a hash. We don't know of a lookup endpoint. In order of preference:

1. A lookup endpoint from dLogos, by feed URL or Podcast Index id (ask them).
2. If dLogos can list its shows, sync that list nightly and match on normalized title plus author, then confirm by checking that a recent episode GUID matches.
3. Fill in mappings by hand for the shows that matter during dogfood (`matched_by = 'manual'`).

**Port from Python:** the response envelope handling and paging in `dlogos_test.py`, and the transcript format ranking in `podcast_ingest/transcript.py`. Add fixture tests from the saved response.

### Lining up timings

The sample shows dLogos' audio can be about 2 minutes longer than the reported duration, so a highlight's range can't be read straight off dLogos' times. Three levels:

1. **Exact:** the highlight's `anchorDurationSec` is within 2 s of the transcript's `audio_duration_sec`. Use the range as it is.
2. **Aligned:** the durations differ. Work out an offset by matching the text in the highlight's time window ±Δ, where Δ is the duration difference, against the transcript. Without words on the listener's side, the practical anchors are chapter boundaries and silence/ad positions. Start simple: assume the inserted ads are ahead of the highlight, try the offsets {0, ±Δ}, and keep the one whose segment boundaries line up best with the captured edges. Mark the result `aligned`.
3. **Approximate:** no confident alignment. Show the excerpt with a "may be off by a little" marker (the spec's "position may have shifted" state).

The real fix is a fingerprint of the listener's audio. One option is to transcribe 10 s of it on the device at capture time. It's worth a spike once phase 2 is live and we can measure how often levels 2 and 3 happen. Also ask dLogos whether they strip dynamic ads, or can return times measured against an ad-free cut.

## Embeddings

### What gets embedded

| Item | Text embedded | Scope | When |
| --- | --- | --- | --- |
| Episode description | Title, show title and show notes as plain text (`lib/show-notes.ts` already parses them) | **Every catalog episode** | On ingest. Cheap, needs no transcript, and gives discovery a corpus on day one |
| Takeaways | Each takeaway, plus its tags | Episodes with a dLogos transcript | After the transcript arrives |
| Chapters | Chapter title plus its first ~200 words | Same | Same |
| Transcript windows | About 60–90 s windows, cut on segment boundaries with a one-segment overlap, about 250–400 tokens each. Skip windows that look like ads (see below) | **Partial:** only episodes that pass a gate (below) | After chunking |
| Highlight | Excerpt plus note, with the chapter title as context | Per user | When the context or note changes, debounced |

"Partial embeddings" in practice means:

- Every transcribed episode gets its cheap summary vectors (takeaways and chapters).
- **Window vectors** are kept only where they're likely to be useful:
  - around highlights (±2 windows)
  - episodes from the shows each user subscribes to
  - the corpus-seeding set
- **Ad detection**, at first: windows that dLogos doesn't place in any chapter, or whose text matches sponsor phrases ("brought to you by", promo codes). Leaving ads in means every show resembles every other show that runs the same sponsor, which skews discovery.

### Model and size

- Use an `Embedder` interface, implemented first with OpenAI `text-embedding-3-small` at 512 dimensions. The prototype already uses OpenAI and there's a key in the root `.env`. The `dimensions` parameter shortens its vectors with little loss. Voyage is the obvious alternative to evaluate. Record `model` on every row, so changing models means re-embedding in the background and switching which model queries read.
- **Cost doesn't limit us.** One episode is about 8k tokens, so embedding every transcript in full costs a tiny fraction of a cent each at current OpenAI prices (check before relying on it).
- **Index size does.** A 1536-dimension float vector is 6 KB. A 512-dimension `halfvec` is about 1 KB. An episode with about 40 windows comes to roughly 40 KB at 512/half, against 240 KB at full size. That's 4 GB against 24 GB at 100k episodes. Going partial on windows and using half precision keeps the HNSW index in memory on a modest managed database.

## Vector storage: why Postgres, and when to switch

### Why pgvector now, rather than Chroma or Qdrant

Any of the three can store and search these vectors. The difference is where the rest of the data lives and how many services we run.

1. **Discovery queries mostly filter on data that's already in Postgres.** A recommendation finds the nearest vectors, then drops episodes the user has played, queued or highlighted, matches language, and caps episodes per show. In Postgres that's one query joining `embeddings` to `user_episode_states`, `highlights` and `episodes`. A separate store would need that metadata copied into each vector's payload and kept current, or the API would have to fetch extra candidates and filter them itself.
2. **Deletes stay consistent, and some of them are privacy deletes.** Deleting an account removes the user's highlight, note and profile vectors in the same transaction (`on delete cascade`). Reprocessing a transcript replaces its chunks and their vectors together. With a second store, every write goes to two places. A failed delete there leaves vectors of private notes behind, which is a privacy failure, not just stale data.
3. **The data is small.** The estimate under Embeddings is about 4M vectors, around 4 GB, at 100k episodes. pgvector's HNSW index handles that well. Dedicated stores pull clearly ahead in the tens of millions, or under heavy query load.
4. **One less service to run.** Hosting isn't chosen yet. CI and the end-to-end stack already run Postgres. A vector store adds another service to host, secure, back up, monitor and stand up in tests. Every major managed Postgres offers pgvector.
5. **Keyword and semantic search together.** Transcript and note search already use Postgres full-text indexes (`tsvector`). Combining keyword and vector scores, for example with reciprocal rank fusion, is one SQL query.

**Chroma** was the right choice for the prototype: it's easy to run locally. It's less proven as a multi-user production server, so if we ever move off Postgres, the move should be to **Qdrant**.

### What a dedicated store does better

These are the reasons the decision could change:

- **Filtered search at scale.** Qdrant applies filters inside the index search. pgvector's HNSW search applies a `where` clause after scanning the index, so a selective filter (one user's vectors, one language) can return fewer than `k` rows. pgvector 0.8's iterative index scans (`hnsw.iterative_scan`) mostly fix this. Qdrant is still more predictable.
- **Memory.** Qdrant offers scalar, product and binary quantization with rescoring, and can keep vectors on disk. pgvector has `halfvec` and binary quantization through expression indexes, which go a long way but need more hand work.
- **Keeping the workloads apart.** In Postgres, building HNSW indexes and rebuilding profiles uses the same CPU and memory that serve sync and sign-in. A separate store means a heavy recommendations job can't slow down the app.
- **Features we might want later.** These include multi-vector or late-interaction retrieval (ColBERT-style, for moment-level matching), sharding and replication built for vectors, and snapshots of a collection.

### When it's smart to switch

Switch when **a trigger below is measured and the cheaper fixes have been tried**. Benchmarks and expected growth alone aren't reasons. To make the triggers measurable, stage D logs these from day one:

- latency of each vector query (p50 and p95)
- the requested `k` against rows returned (the "underfill" rate)
- the size of the HNSW index against memory
- recall@k against exact search, on a nightly sample

| Trigger | Measure | Threshold to act on |
| --- | --- | --- |
| The index outgrows memory | `pg_relation_size` of the HNSW index against the instance's RAM | Index above about half of RAM, or about 20–50M global vectors |
| Slow candidate queries | p95 of the recommendation candidate query, after tuning `ef_search` | Above about 100 ms, or above about 300 ms for the whole recommendations endpoint |
| Filters starve results | Share of filtered queries returning fewer than `k` rows, with iterative scans on | Above about 5% |
| Recall drops | recall@k against exact search, on the offline hold-out | Below about 0.95 at a `ef_search` that meets the latency target |
| Vector work hurts the app | API and sync p95 while profiles or indexes rebuild | A visible regression that a read replica doesn't fix |
| Rebuilds get too long | Time to build or reindex HNSW | Longer than a maintenance window, roughly hours, or index bloat from frequent updates |
| A needed feature is missing | Product requirement | Multi-vector retrieval, or per-tenant sharding, becomes a real requirement |

**Try these first, roughly in order of cost:**

1. Tune HNSW: raise `ef_search`, rebuild with higher `m` and `ef_construction`, and turn on `hnsw.iterative_scan` for filtered queries.
2. Use partial indexes per `owner_kind` (and per language once there are several), so each query searches a smaller graph.
3. Shrink the vectors: use fewer dimensions, which `text-embedding-3` allows, or binary quantization in an expression index with `halfvec` rescoring.
4. Partition `embeddings` by `owner_kind`, and move per-user rows to their own table.
5. Send vector reads to a **read replica**, so recommendation load is kept apart from writes.
6. Move to a bigger instance, or one with more memory.

If a trigger still holds after the steps that apply to it, switch.

### Switching without losing the system of record

`VectorIndex` is the boundary:

```ts
interface VectorIndex {
  upsert(rows: { id: string; vec: Float32Array; filter: VectorFilterFields }[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
  search(vec: Float32Array, opts: { k: number; filter: VectorFilter }): Promise<{ id: string; score: number }[]>;
}
```

Callers depend on that interface and never on SQL against `embeddings` directly. Joins that must stay in SQL, such as "not played by this user", happen after the search, on the returned ids. Moving to a dedicated store then works like this:

1. **Postgres stays the system of record.** The `embeddings` table keeps every vector. Qdrant becomes an index that can be rebuilt from it at any time, and losing or corrupting it loses nothing.
2. **Move only global content vectors** (chunks, episode descriptions, takeaways). These are public data, and they're where nearly all the volume is. **Per-user vectors (highlights, notes, profiles) stay in Postgres.** There are few of them per user, they're searched within one user's rows, and they keep deleting in the same transaction as the account.
3. **Copy, then compare, then cut over.**
   - Add `QdrantVectorIndex`.
   - After each embed job writes to Postgres, it enqueues an `index.sync` job, using the job queue so a failed copy retries.
   - Backfill from `embeddings`.
   - Read from both indexes and compare their top-k overlap in shadow, using the offline hold-out.
   - Switch reads with a flag, and keep the pgvector index for a release as a fallback.
4. **Reconcile nightly.** Compare ids and counts between `embeddings` and Qdrant, and repair any drift.

This keeps the switch to roughly a week of work whenever the triggers say so. It doesn't touch the sync API, the privacy model or the discovery logic.

## Discovery

The first version is retrieval plus a few rules, with no model training, built so we can measure it.

1. **Interest profile per user.** Group the user's highlight and note vectors into up to k interests (k-means, k ≤ 5, weighted toward recent ones with a half-life of about 60 days). Store each centroid as an `embeddings` row with `owner_kind='profile'`, keeping the highlights that formed it. Rebuild after 5 new highlights or once a day. One average would smear distinct interests (say, trade policy and running) into a vector that matches neither.
2. **Find candidates.** For each interest, find the nearest global vectors: episode descriptions, takeaways and windows. Merge them by episode.
3. **Filter:** no episodes already played, highlighted or queued, and no episodes from a show more than N times. Language must match `locale.ts`.
4. **Rank** by best similarity, plus a small bonus for recent episodes and for shows the user doesn't subscribe to (discovery should find new shows, not just new episodes of known ones). Hand-tuned weights.
5. **Explain each pick** using the highlight that matched: "Because you highlighted *'…'* in *The Daily*". Window and takeaway matches point to a timestamp, so a recommendation can open the episode at the right moment, the same way share links already do.
6. **Record feedback** (shown, opened, played more than 5 minutes, highlighted, dismissed) in a `rec_events` table. This is what measures discovery and, later, trains a ranker.

**Endpoint:** `GET /v1/me/recommendations`, cached per user for an hour and rebuilt by the worker.

**Evaluation before the UI:** use a hold-out. For dogfood users, hide the most recent highlighted episode and check whether it's among the top 20 candidates built from the other highlights. Running this offline lets us compare chunk sizes, models and partial-vs-full windows without shipping anything.

**The corpus problem.** Recommendations can only include episodes that have vectors. Description vectors cover the whole catalog, but our catalog is only shows someone has added. To reach beyond that:

- Bring the latest N episodes of Podcast Index trending and category shows into the catalog (feeds only, cheap).
- Spend the dLogos seeding budget on the most-subscribed and most-highlighted shows first.

## Privacy

- Highlights, notes, their vectors and interest profiles are user data. They're deleted with the account (cascade) and never used across users without the separate consent the highlights spec already requires for "popular moments".
- Sending notes and excerpts to the embedding provider makes that provider a data processor. That needs a line in the privacy policy and the store data-safety forms, and an API setting that stops the provider training on or keeping the data. We could embed only excerpts for users who opt out, or self-host a small open model for user text.
- dLogos receives public identifiers only, from the server, as already specced.

## The Python prototype

| Piece | Decision |
| --- | --- |
| `dlogos_test.py` and `data/dlogos/` | Port to `packages/content/src/dlogos.ts`. Keep the JSON as a test fixture |
| `podcast_ingest/transcript.py` (format ranking) | Port the ranking into the publisher transcript source |
| `podcast_ingest` SQLite store and pipeline | Retire. The catalog and feed worker already do this better |
| Flask app and Chroma | Retire. pgvector replaces Chroma |
| Root `.env` (OpenAI and dLogos keys) | Move both keys to `apps/api/.env` and the worker's `.env`, and add them to the production settings check (`config.ts`) |

Python may still be useful for offline evaluation notebooks that read straight from Postgres. It shouldn't run anything in the product.

## Phasing

| Stage | Contents | Unblocks | Gate |
| --- | --- | --- | --- |
| **A. Foundations** (about 1 week) | Migration 006 (catalog columns, jobs, dLogos mapping); `packages/content` scaffold; `content-worker`; the `JobQueue` contract tests; pgvector in CI and the Docker image | Everything | Pick a host that supports pgvector (or at least confirm the shortlist does) |
| **B. Transcripts** (about 1.5 weeks) | 007; the dLogos client, job flow and fallback; publisher parsers; `GET /v1/episodes/:id/transcript?start&end` and `/status`; manual slug mappings for dogfood shows | Highlights phase 2 | dLogos terms (caching and display allowed), quota |
| **C. Highlights as data** (about 1 week) | 008; server-owned excerpts with timing levels 1–3; `GET /v1/me/highlights?q=` (full-text search over notes and excerpts); client shows "aligned" and "approximate" | Highlights phase 2 shipped | B |
| **D. Embeddings** (about 1 week) | 009; the `Embedder` and the pgvector `VectorIndex`; vector query metrics (latency, underfill, index size, sampled recall); chunker v1 with ad skipping; description vectors for the whole catalog; highlight and note vectors; backfill jobs | Discovery, plus semantic search over your own highlights (a useful feature on its own) | Decide on the embedding provider and the privacy wording |
| **E. Discovery v0** (about 2 weeks) | Profiles, retrieval, ranking, explanations, `rec_events`, the offline hold-out evaluation, then a "For you" section on Discover | | Enough dogfood highlights to evaluate (around 50+ across a few users) |

Sizes are rough estimates for one developer, as in the highlights spec. B and C together are the highlights spec's phase 2.

## Open questions

1. **What does "notes" cover?** Only notes on highlights (as built), or also notes on a whole episode or show, or free-standing notes? This decides whether stage C adds a `notes` table now.
2. **dLogos:**
   - Is there a slug lookup by feed URL?
   - Can we list the shows and episodes they've already processed? Those might cost less, or nothing, to fetch, which changes the seeding economics.
   - What are pricing and quotas, and may we cache and display transcripts?
   - Do their times include dynamically inserted ads?
3. **dLogos as the main source:** is the reason consistency (speakers, chapters, takeaways for every episode), or do you trust its text over publisher transcripts? If a publisher transcript is ready first, should we show it while dLogos is pending (proposed: yes, then switch)?
4. **Embedding provider:** is OpenAI (key already in hand) acceptable for listener notes, or do you want user text kept with fewer third parties?
5. **The discovery surface:** a "For you" section on Discover, recommendations on the episode page ("more like this moment"), or both? It changes whether moment-level (window) vectors are needed in v0, or only episode-level ones.
6. **Hosting:** stage A wants a Postgres host with pgvector chosen, or at least narrowed down. This turns the open "choose hosting" to-do into a requirement.
