-- Content layer foundations: publisher transcript links, the dLogos show mapping, and a job queue.

-- The feed parser already extracted these (F-16 groundwork); now the catalog keeps them.
alter table episodes add column transcript_url text;
alter table episodes add column transcript_type text;
alter table episodes add column chapters_url text;

-- How we find a show at dLogos, which identifies shows by its own slug (e.g. the-daily-a12f141d).
create table dlogos_podcasts (
  podcast_id text primary key references podcasts (id) on delete cascade,
  slug text not null,
  dlogos_podcast_id text,
  matched_by text not null check (matched_by in ('manual', 'api_lookup', 'title_match')),
  confidence real not null default 1,
  checked_at timestamptz not null default now()
);

-- Background work for the content worker. One live job per (kind, key), so enqueueing twice is
-- harmless. Claimed with a lease (`for update skip locked`), like the feed worker claims feeds.
create table jobs (
  id bigserial primary key,
  kind text not null,
  key text not null,
  payload jsonb not null default '{}',
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  leased_until timestamptz,
  last_error text,
  done_at timestamptz,
  failed boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index jobs_live on jobs (kind, key) where done_at is null;
create index jobs_due on jobs (run_at) where done_at is null;

-- dLogos requests per day, so corpus seeding stays inside a budget.
create table dlogos_usage (
  day date not null,
  purpose text not null, -- 'highlight' | 'transcript_view' | 'seed'
  requests integer not null default 0,
  primary key (day, purpose)
);
