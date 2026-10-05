-- Accounts (F-12) and per-user state that syncs across devices (F-13).

create table users (
  id uuid primary key,
  email text not null unique, -- stored lowercased
  created_at timestamptz not null default now()
);

-- Email sign-in requests: a link token (for web) and a 6-digit code (for phones), stored hashed.
create table sign_in_requests (
  id uuid primary key,
  email text not null,
  token_hash text not null unique,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index sign_in_requests_email on sign_in_requests (email, created_at desc);

-- One row per signed-in device. The refresh token is stored hashed and rotated on every use.
create table sessions (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  refresh_hash text not null unique,
  platform text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions (user_id);

-- Every change to per-user state takes the next value, so "changes since N" is one index scan.
create sequence sync_version;

create table user_subscriptions (
  user_id uuid not null references users (id) on delete cascade,
  podcast_id text not null,
  subscribed_at bigint not null,
  auto_download boolean not null default false,
  updated_at bigint not null, -- client clock, epoch ms
  deleted boolean not null default false,
  version bigint not null,
  primary key (user_id, podcast_id)
);

create table user_episode_states (
  user_id uuid not null references users (id) on delete cascade,
  episode_id text not null,
  position_sec double precision not null,
  played boolean not null,
  updated_at bigint not null,
  version bigint not null,
  primary key (user_id, episode_id)
);

create table user_queue_items (
  user_id uuid not null references users (id) on delete cascade,
  episode_id text not null,
  sort_key text not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  primary key (user_id, episode_id)
);

create table user_settings (
  user_id uuid primary key references users (id) on delete cascade,
  settings jsonb not null,
  updated_at bigint not null,
  version bigint not null
);

create index user_subscriptions_version on user_subscriptions (user_id, version);
create index user_episode_states_version on user_episode_states (user_id, version);
create index user_queue_items_version on user_queue_items (user_id, version);
