-- Highlights: per-user, synced. Stored whole as JSON; merging happens in the API.
create table user_highlights (
  user_id uuid not null references users (id) on delete cascade,
  id uuid not null,
  highlight jsonb not null,
  version bigint not null,
  primary key (user_id, id)
);
create index user_highlights_version on user_highlights (user_id, version);
