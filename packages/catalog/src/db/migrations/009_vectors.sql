-- Embeddings and discovery. Needs the pgvector extension (0.7 or newer, for halfvec); see
-- docs/deploy.md for installing it locally and in production.
create extension if not exists vector;

-- Pieces of a transcript worth embedding: windows of segments, chapters and takeaways.
create table transcript_chunks (
  id bigserial primary key,
  transcript_id uuid not null references transcripts (id) on delete cascade,
  chunker_version integer not null,
  kind text not null check (kind in ('window', 'chapter', 'takeaway')),
  seg_from integer,
  seg_to integer,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  is_ad boolean not null default false
);
create index transcript_chunks_transcript on transcript_chunks (transcript_id, chunker_version);

-- Every vector, keyed by what was embedded. This table is the system of record; a VectorIndex
-- searches it (pgvector here, possibly a dedicated store later; see 06-data-layer-plan.md).
-- Global content has user_id null. Per-user rows are deleted with the account.
create table embeddings (
  id bigserial primary key,
  owner_kind text not null check (owner_kind in ('chunk', 'episode', 'highlight', 'note', 'profile')),
  owner_id text not null,
  user_id uuid references users (id) on delete cascade,
  episode_id text,
  podcast_id text,
  language text,
  start_ms integer,
  model text not null,
  input_hash text not null,
  vec halfvec(512) not null,
  created_at timestamptz not null default now(),
  unique (owner_kind, owner_id, model)
);
create index embeddings_user on embeddings (user_id, owner_kind) where user_id is not null;
create index embeddings_episode on embeddings (episode_id);
-- Global content only: per-user vectors are few per user and searched by exact scan.
create index embeddings_global_vec on embeddings using hnsw (vec halfvec_cosine_ops) where user_id is null;

-- Cached recommendations per user, rebuilt by the content worker.
create table user_recommendations (
  user_id uuid primary key references users (id) on delete cascade,
  items jsonb not null,
  generated_at timestamptz not null default now()
);

-- What happened to recommendations: the measure of discovery, and later training data.
create table rec_events (
  id bigserial primary key,
  user_id uuid not null references users (id) on delete cascade,
  episode_id text not null,
  event text not null check (event in ('shown', 'opened', 'played', 'highlighted', 'dismissed')),
  at timestamptz not null default now()
);
create index rec_events_user on rec_events (user_id, at desc);
