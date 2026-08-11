-- ============================================================
-- SCHEMAS & POLICIES SUPABASE PER PARTIAMO (POSTGRESQL + RLS)
-- Esegui questo script nell'Editor SQL del tuo progetto Supabase
-- ============================================================

-- 1. PROFILI UTENTI
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;

create policy "Gli utenti possono leggere il proprio profilo"
  on public.profiles for select using (auth.uid() = id);

create policy "Gli utenti possono aggiornare il proprio profilo"
  on public.profiles for update using (auth.uid() = id);

-- Trigger per creare automaticamente un profilo alla registrazione
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. VIAGGI
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  dest text not null,
  country text,
  start_date date not null,
  end_date date not null,
  travelers integer default 1,
  transport text default 'aereo',
  airline text default 'nessuna',
  fare text default 'nessuna',
  invite_code text unique default encode(gen_random_bytes(6), 'hex'),
  created_at timestamp with time zone default now()
);

alter table public.trips enable row level security;

-- 3. PARTECIPANTI AL VIAGGIO
create table if not exists public.trip_participants (
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text default 'member', -- 'owner' | 'member'
  joined_at timestamp with time zone default now(),
  primary key (trip_id, user_id)
);

alter table public.trip_participants enable row level security;

create policy "Membri possono vedere i viaggi a cui partecipano"
  on public.trips for select using (
    exists (
      select 1 from public.trip_participants tp
      where tp.trip_id = trips.id and tp.user_id = auth.uid()
    )
  );

create policy "Utenti autenticati possono creare viaggi"
  on public.trips for insert with check (auth.role() = 'authenticated');

create policy "Owner può aggiornare il viaggio"
  on public.trips for update using (owner_id = auth.uid());

create policy "Visualizzazione partecipanti"
  on public.trip_participants for select using (
    exists (
      select 1 from public.trip_participants tp
      where tp.trip_id = trip_participants.trip_id and tp.user_id = auth.uid()
    )
  );

create policy "Aggiunta partecipanti"
  on public.trip_participants for insert with check (auth.role() = 'authenticated');

-- 4. POI (CONDIVISI NEL VIAGGIO)
create table if not exists public.pois (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  created_by uuid references public.profiles(id),
  name text not null,
  addr text,
  maps_url text,
  cat text default 'visita',
  day date,
  notes text,
  files jsonb default '[]'::jsonb,
  created_at timestamp with time zone default now()
);

alter table public.pois enable row level security;

create policy "Partecipanti possono leggere i POI"
  on public.pois for select using (
    exists (
      select 1 from public.trip_participants tp
      where tp.trip_id = pois.trip_id and tp.user_id = auth.uid()
    )
  );

create policy "Partecipanti possono inserire POI"
  on public.pois for insert with check (
    exists (
      select 1 from public.trip_participants tp
      where tp.trip_id = pois.trip_id and tp.user_id = auth.uid()
    )
  );

create policy "Partecipanti possono aggiornare ed eliminare POI"
  on public.pois for all using (
    exists (
      select 1 from public.trip_participants tp
      where tp.trip_id = pois.trip_id and tp.user_id = auth.uid()
    )
  );

-- 5. ITINERARIO (CONDIVISO NEL VIAGGIO)
create table if not exists public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  created_by uuid references public.profiles(id),
  day date not null,
  slot text not null,
  text text not null,
  place text,
  created_at timestamp with time zone default now()
);

alter table public.itinerary_items enable row level security;

create policy "Partecipanti possono gestire l'itinerario"
  on public.itinerary_items for all using (
    exists (
      select 1 from public.trip_participants tp
      where tp.trip_id = itinerary_items.trip_id and tp.user_id = auth.uid()
    )
  );

-- 6. CONTATTI (CONDIVISI NEL VIAGGIO)
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  created_by uuid references public.profiles(id),
  kind text default 'struttura',
  name text not null,
  phone text,
  email text,
  addr text,
  cin text,
  cout text,
  ref text,
  notes text,
  files jsonb default '[]'::jsonb,
  created_at timestamp with time zone default now()
);

alter table public.contacts enable row level security;

create policy "Partecipanti possono gestire i contatti"
  on public.contacts for all using (
    exists (
      select 1 from public.trip_participants tp
      where tp.trip_id = contacts.trip_id and tp.user_id = auth.uid()
    )
  );

-- 7. VAULT (PRIVATO PER CIASCUN UTENTE)
create table if not exists public.vault_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  trip_id uuid references public.trips(id) on delete cascade,
  type text default 'altro',
  title text not null,
  expiry_date date,
  notes text,
  fields jsonb default '{}'::jsonb,
  files jsonb default '[]'::jsonb,
  created_at timestamp with time zone default now()
);

alter table public.vault_docs enable row level security;

create policy "Vault e accessibile SOLO dal proprietario"
  on public.vault_docs for all using (user_id = auth.uid());

-- 8. CHECKLIST (PRIVATA PER CIASCUN UTENTE)
create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  trip_id uuid references public.trips(id) on delete cascade not null,
  items jsonb default '[]'::jsonb,
  updated_at timestamp with time zone default now(),
  unique (user_id, trip_id)
);

alter table public.checklists enable row level security;

create policy "Checklist e accessibile SOLO dal proprietario"
  on public.checklists for all using (user_id = auth.uid());
