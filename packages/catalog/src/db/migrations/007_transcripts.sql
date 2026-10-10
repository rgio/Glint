-- Transcripts: global content, one row per episode and source. Readers choose dLogos when it's
-- ready and a timed publisher transcript otherwise (the episode_transcript view).

create table transcripts (
  id uuid primary key,
  episode_id text not null references episodes (id) on delete cascade,
  source text not null check (source in ('dlogos', 'publisher_json', 'publisher_vtt', 'publisher_srt')),
  status text not null check (status in ('pending', 'ready', 'failed', 'unavailable')),
  language text,
  -- Length of the audio this transcript was made from (its last segment's end). Compared with a
  -- highlight's anchor duration to tell whether the listener heard the same audio.
  audio_duration_sec double precision,
  -- The duration the source reported, which can differ (dLogos: ~112 s off on The Daily).
  reported_duration_sec double precision,
  audio_url text,
  -- The source's own episode id and how to ask it for progress (dLogos: the poll URL).
  external_id text,
  poll_url text,
  raw jsonb,
  error text,
  requested_at timestamptz not null default now(),
  fetched_at timestamptz,
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

create table episode_chapters (
  transcript_id uuid not null references transcripts (id) on delete cascade,
  position integer not null,
  start_ms integer not null,
  title text not null,
  primary key (transcript_id, position)
);

create table episode_takeaways (
  transcript_id uuid not null references transcripts (id) on delete cascade,
  position integer not null,
  start_ms integer,
  text text not null,
  tags text[] not null default '{}',
  primary key (transcript_id, position)
);

-- The transcript every reader uses for an episode: dLogos if ready, else the best ready publisher one.
create view episode_transcript as
select distinct on (episode_id) *
from transcripts
where status = 'ready'
order by episode_id,
  case source when 'dlogos' then 0 when 'publisher_json' then 1 when 'publisher_vtt' then 2 else 3 end;
