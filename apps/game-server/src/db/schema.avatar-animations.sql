-- Tablas de animaciones de avatar publicadas por administradores.
-- Se aplican en un paso aparte y opcional: si fallan, el servidor arranca igual y esta funcion queda desactivada.
create table if not exists avatar_animation_documents (
  id text primary key,
  name text not null,
  document jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists avatar_animation_config (
  id text primary key,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

-- Historial de publicaciones: cada publicacion guarda la configuracion y las animaciones que usa.
create table if not exists avatar_animation_history (
  id bigserial primary key,
  config jsonb not null,
  documents jsonb not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
