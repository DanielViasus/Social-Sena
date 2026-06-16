create table if not exists users (
  user_id text primary key,
  username text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists player_profiles (
  user_id text primary key references users(user_id) on delete cascade,
  skin_id text not null,
  skin_colors jsonb not null default '{}'::jsonb,
  audio_settings jsonb not null default '{"musicEnabled":true,"musicVolume":0.15,"sfxEnabled":true,"sfxVolume":1}'::jsonb,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists player_state (
  user_id text primary key references users(user_id) on delete cascade,
  last_room_id text,
  last_pos_x double precision,
  last_pos_y double precision,
  updated_at timestamptz not null default now()
);

create table if not exists player_progress (
  user_id text primary key references users(user_id) on delete cascade,
  level integer not null default 1,
  experience integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists player_inventory (
  user_id text primary key references users(user_id) on delete cascade,
  inventory jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists friendships (
  user_id text not null references users(user_id) on delete cascade,
  friend_user_id text not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

create index if not exists idx_friendships_friend_user_id on friendships(friend_user_id);

create table if not exists friend_requests (
  request_id text primary key,
  from_user_id text not null references users(user_id) on delete cascade,
  to_user_id text not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create index if not exists idx_friend_requests_to_user_id on friend_requests(to_user_id);
create index if not exists idx_friend_requests_from_user_id on friend_requests(from_user_id);

create table if not exists parties (
  party_id text primary key,
  leader_user_id text not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_parties_leader_user_id on parties(leader_user_id);

create table if not exists party_members (
  party_id text not null references parties(party_id) on delete cascade,
  user_id text not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (party_id, user_id),
  unique (user_id)
);

create index if not exists idx_party_members_user_id on party_members(user_id);

create table if not exists party_invites (
  invite_id text primary key,
  party_id text not null references parties(party_id) on delete cascade,
  from_user_id text not null references users(user_id) on delete cascade,
  to_user_id text not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (party_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create index if not exists idx_party_invites_to_user_id on party_invites(to_user_id);
create index if not exists idx_party_invites_from_user_id on party_invites(from_user_id);
create index if not exists idx_party_invites_party_id on party_invites(party_id);

alter table if exists player_profiles
add column if not exists onboarding_completed boolean not null default true;

alter table if exists player_profiles
alter column onboarding_completed set default false;

alter table if exists player_profiles
add column if not exists audio_settings jsonb not null default '{"musicEnabled":true,"musicVolume":0.15,"sfxEnabled":true,"sfxVolume":1}'::jsonb;

alter table if exists player_profiles
alter column audio_settings set default '{"musicEnabled":true,"musicVolume":0.15,"sfxEnabled":true,"sfxVolume":1}'::jsonb;

update player_profiles
set
  audio_settings = '{"musicEnabled":true,"musicVolume":0.15,"sfxEnabled":true,"sfxVolume":1}'::jsonb,
  updated_at = now()
where audio_settings = '{"musicEnabled":true,"musicVolume":0.42,"sfxEnabled":true,"sfxVolume":0.8}'::jsonb;
