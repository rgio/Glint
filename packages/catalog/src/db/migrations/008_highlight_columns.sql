-- Highlights as columns rather than one JSON blob, so the server can search, join and index them.
-- The sync contract (the Highlight type) is unchanged. The excerpt, chapter and confidence are
-- server-owned and live in highlight_context.

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
  created_at bigint not null,
  range_updated_at bigint not null,
  note_updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  note_tsv tsvector generated always as (to_tsvector('english', coalesce(note, ''))) stored,
  primary key (user_id, id)
);
create index highlights_version on highlights (user_id, version);
create index highlights_episode on highlights (episode_id) where not deleted;
create index highlights_note_tsv on highlights using gin (note_tsv);

-- Worked out on the server from the range and the episode's transcript. Only shown while
-- for_range_updated_at matches the highlight's range_updated_at, so a range edit hides it until
-- it's recomputed.
create table highlight_context (
  user_id uuid not null,
  highlight_id uuid not null,
  transcript_id uuid references transcripts (id) on delete set null,
  excerpt text,
  chapter_title text,
  offset_sec double precision not null default 0,
  confidence text check (confidence in ('exact', 'aligned', 'approximate')),
  for_range_updated_at bigint not null,
  computed_at timestamptz not null default now(),
  excerpt_tsv tsvector generated always as (to_tsvector('english', coalesce(excerpt, ''))) stored,
  primary key (user_id, highlight_id),
  foreign key (user_id, highlight_id) references highlights (user_id, id) on delete cascade
);
create index highlight_context_tsv on highlight_context using gin (excerpt_tsv);

insert into highlights (user_id, id, episode_id, podcast_id, start_sec, end_sec, note, source,
  anchor_duration_sec, anchor_enclosure_url, created_at, range_updated_at, note_updated_at, deleted, version)
select user_id, id,
  highlight->>'episodeId',
  highlight->>'podcastId',
  (highlight->>'startSec')::double precision,
  (highlight->>'endSec')::double precision,
  highlight->>'note',
  highlight->>'source',
  (highlight->>'anchorDurationSec')::double precision,
  highlight->>'anchorEnclosureUrl',
  (highlight->>'createdAt')::bigint,
  (highlight->>'rangeUpdatedAt')::bigint,
  (highlight->>'noteUpdatedAt')::bigint,
  coalesce((highlight->>'deleted')::boolean, false),
  version
from user_highlights;

drop table user_highlights;
