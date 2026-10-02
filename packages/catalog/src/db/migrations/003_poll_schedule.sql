-- Feed worker schedule. A null next_poll_at means "due now" (newly added feeds).
alter table podcasts add column next_poll_at timestamptz;
alter table podcasts add column poll_failures integer not null default 0;
create index podcasts_next_poll_at on podcasts (next_poll_at nulls first);
