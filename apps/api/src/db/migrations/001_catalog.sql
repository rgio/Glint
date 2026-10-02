-- Catalog: podcasts and episodes, global and read-only to clients.

create table podcasts (
  id text primary key,
  feed_url text not null unique,
  title text not null,
  author text,
  description text,
  artwork_url text,
  language text,
  categories text[] not null default '{}',
  explicit boolean not null default false,
  last_published_at timestamptz,
  -- Conditional-fetch headers from the last time the feed was fetched.
  feed_etag text,
  feed_last_modified text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table episodes (
  id text primary key,
  podcast_id text not null references podcasts (id) on delete cascade,
  guid text not null,
  title text not null,
  published_at timestamptz,
  duration_sec double precision,
  enclosure_url text not null,
  enclosure_type text,
  enclosure_bytes bigint,
  show_notes_html text,
  artwork_url text,
  season integer,
  episode_number integer,
  updated_at timestamptz not null default now()
);

create index episodes_podcast_published on episodes (podcast_id, published_at desc nulls last);
