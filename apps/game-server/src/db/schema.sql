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

alter table if exists player_profiles
add column if not exists onboarding_completed boolean not null default true;

alter table if exists player_profiles
alter column onboarding_completed set default false;
