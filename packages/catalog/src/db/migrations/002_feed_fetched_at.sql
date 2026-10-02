-- When the feed was last fetched (including "not modified" answers), so stale feeds get re-checked.
alter table podcasts add column feed_fetched_at timestamptz;
update podcasts set feed_fetched_at = updated_at;
