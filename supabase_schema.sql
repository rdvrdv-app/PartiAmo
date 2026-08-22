-- ============================================================
-- SCHEMA & POLICY SUPABASE PER PARTIAMO (POSTGRESQL + RLS)
-- Esegui questo script nell'Editor SQL del tuo progetto Supabase.
--
-- LO SCRIPT È IDEMPOTENTE: puoi rieseguirlo su un progetto già
-- esistente senza perdere dati. Aggiorna colonne, policy e indici.
--
-- PERCHÉ RIESEGUIRLO È NECESSARIO:
-- la versione precedente definiva su trip_participants una policy che
-- interrogava trip_participants stessa. PostgreSQL rileva la ricorsione
-- infinita (errore 42P17) e FA FALLIRE OGNI SELECT su trips e
-- trip_participants: per questo, entrando da un altro dispositivo (o
-- dopo aver cancellato i cookie), il viaggio salvato non compariva.
-- Qui la verifica di appartenenza passa da funzioni SECURITY DEFINER,
-- che non riattivano la RLS e quindi non ricorrono.
-- ============================================================

-- ============================================================
-- 0. FUNZIONI DI SUPPORTO (SECURITY DEFINER = niente ricorsione RLS)
-- ============================================================

-- Le funzioni qui sotto citano tabelle create più avanti nello script:
-- su un database vuoto la validazione del corpo fallirebbe. La verifica
-- avviene comunque alla prima esecuzione, quando le tabelle esistono.
set check_function_bodies = off;

-- L'utente corrente partecipa al viaggio indicato?
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.trip_participants tp
    where tp.trip_id = p_trip_id
      and tp.user_id = auth.uid()
  );
$$;

-- L'utente corrente condivide almeno un viaggio con l'utente indicato?
-- Serve a mostrare nome/email dei compagni di viaggio senza esporre
-- l'intera tabella dei profili.
create or replace function public.shares_trip_with(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.trip_participants mine
    join public.trip_participants theirs on theirs.trip_id = mine.trip_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

-- ============================================================
-- 1. PROFILI UTENTI
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Gli utenti possono leggere il proprio profilo" on public.profiles;
drop policy if exists "Gli utenti possono aggiornare il proprio profilo" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;

create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.shares_trip_with(id));

-- Necessaria: se un account è stato creato prima del trigger qui sotto,
-- il profilo non esiste e l'inserimento di un viaggio fallirebbe per
-- violazione della foreign key trips.owner_id -> profiles.id.
create policy "profiles_insert" on public.profiles
  for insert with check (id = auth.uid());

create policy "profiles_update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Trigger: crea automaticamente il profilo alla registrazione.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Recupero: crea i profili mancanti per gli account già registrati.
insert into public.profiles (id, email, full_name, avatar_url)
select u.id, coalesce(u.email, ''), u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'avatar_url'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ============================================================
-- 2. VIAGGI
-- ============================================================
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

-- Colonne aggiunte dopo la prima versione dello schema.
alter table public.trips add column if not exists prefs jsonb default '{}'::jsonb;
alter table public.trips add column if not exists updated_at timestamp with time zone default now();

alter table public.trips enable row level security;

drop policy if exists "Membri possono vedere i viaggi a cui partecipano" on public.trips;
drop policy if exists "Utenti autenticati possono creare viaggi" on public.trips;
drop policy if exists "Owner può aggiornare il viaggio" on public.trips;
drop policy if exists "trips_select" on public.trips;
drop policy if exists "trips_insert" on public.trips;
drop policy if exists "trips_update" on public.trips;
drop policy if exists "trips_delete" on public.trips;

create policy "trips_select" on public.trips
  for select using (owner_id = auth.uid() or public.is_trip_member(id));

create policy "trips_insert" on public.trips
  for insert with check (owner_id = auth.uid());

create policy "trips_update" on public.trips
  for update using (owner_id = auth.uid() or public.is_trip_member(id))
  with check (owner_id = auth.uid() or public.is_trip_member(id));

create policy "trips_delete" on public.trips
  for delete using (owner_id = auth.uid());

create index if not exists trips_owner_id_idx on public.trips (owner_id);

-- I partecipanti possono modificare i dati del viaggio, ma non diventarne
-- proprietari: senza questo controllo un invitato potrebbe intestarsi il
-- viaggio con un semplice UPDATE e poi cancellarlo.
create or replace function public.protect_trip_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id and old.owner_id is distinct from auth.uid() then
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_protect_owner on public.trips;
create trigger trips_protect_owner
  before update on public.trips
  for each row execute function public.protect_trip_owner();

-- ============================================================
-- 3. PARTECIPANTI AL VIAGGIO
-- ============================================================
create table if not exists public.trip_participants (
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text default 'member', -- 'owner' | 'member'
  joined_at timestamp with time zone default now(),
  primary key (trip_id, user_id)
);

alter table public.trip_participants enable row level security;

drop policy if exists "Visualizzazione partecipanti" on public.trip_participants;
drop policy if exists "Aggiunta partecipanti" on public.trip_participants;
drop policy if exists "trip_participants_select" on public.trip_participants;
drop policy if exists "trip_participants_insert" on public.trip_participants;
drop policy if exists "trip_participants_delete" on public.trip_participants;

-- La prima condizione (user_id = auth.uid()) è indispensabile: senza di
-- essa il primo partecipante non riuscirebbe mai a leggere la propria riga.
create policy "trip_participants_select" on public.trip_participants
  for select using (user_id = auth.uid() or public.is_trip_member(trip_id));

create policy "trip_participants_insert" on public.trip_participants
  for insert with check (user_id = auth.uid());

create policy "trip_participants_delete" on public.trip_participants
  for delete using (user_id = auth.uid());

create index if not exists trip_participants_user_id_idx on public.trip_participants (user_id);

-- Unirsi con il codice invito richiede di leggere un viaggio di cui NON si
-- è ancora membri: la RLS lo impedisce, quindi serve una funzione dedicata.
create or replace function public.join_trip_by_code(p_code text)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'Devi accedere per unirti a un viaggio';
  end if;

  select * into v_trip
  from public.trips
  where lower(invite_code) = lower(trim(p_code))
  limit 1;

  if v_trip.id is null then
    raise exception 'Codice invito non valido o viaggio non trovato';
  end if;

  insert into public.trip_participants (trip_id, user_id, role)
  values (v_trip.id, auth.uid(), 'member')
  on conflict (trip_id, user_id) do nothing;

  return v_trip;
end;
$$;

grant execute on function public.join_trip_by_code(text) to authenticated;

-- ============================================================
-- 4. POI (CONDIVISI NEL VIAGGIO)
-- ============================================================
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

drop policy if exists "Partecipanti possono leggere i POI" on public.pois;
drop policy if exists "Partecipanti possono inserire POI" on public.pois;
drop policy if exists "Partecipanti possono aggiornare ed eliminare POI" on public.pois;
drop policy if exists "pois_all" on public.pois;

create policy "pois_all" on public.pois
  for all using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create index if not exists pois_trip_id_idx on public.pois (trip_id);

-- ============================================================
-- 5. ITINERARIO (CONDIVISO NEL VIAGGIO)
-- ============================================================
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

alter table public.itinerary_items add column if not exists time text;

alter table public.itinerary_items enable row level security;

drop policy if exists "Partecipanti possono gestire l'itinerario" on public.itinerary_items;
drop policy if exists "itinerary_items_all" on public.itinerary_items;

create policy "itinerary_items_all" on public.itinerary_items
  for all using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create index if not exists itinerary_items_trip_id_idx on public.itinerary_items (trip_id);

-- ============================================================
-- 6. CONTATTI (CONDIVISI NEL VIAGGIO)
-- ============================================================
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

drop policy if exists "Partecipanti possono gestire i contatti" on public.contacts;
drop policy if exists "contacts_all" on public.contacts;

create policy "contacts_all" on public.contacts
  for all using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create index if not exists contacts_trip_id_idx on public.contacts (trip_id);

-- ============================================================
-- 7. VAULT (PRIVATO PER CIASCUN UTENTE)
-- ============================================================
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

drop policy if exists "Vault e accessibile SOLO dal proprietario" on public.vault_docs;
drop policy if exists "vault_docs_all" on public.vault_docs;

create policy "vault_docs_all" on public.vault_docs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists vault_docs_user_id_idx on public.vault_docs (user_id);

-- ============================================================
-- 8. CHECKLIST (PRIVATA PER CIASCUN UTENTE)
-- ============================================================
create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  trip_id uuid references public.trips(id) on delete cascade not null,
  items jsonb default '[]'::jsonb,
  updated_at timestamp with time zone default now(),
  unique (user_id, trip_id)
);

alter table public.checklists enable row level security;

drop policy if exists "Checklist e accessibile SOLO dal proprietario" on public.checklists;
drop policy if exists "checklists_all" on public.checklists;

create policy "checklists_all" on public.checklists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- 9. NOTIFICHE PUSH (PRIVATE PER DISPOSITIVO/UTENTE)
-- ============================================================
-- Un'iscrizione push (endpoint + chiavi) è un dato di dispositivo, non di
-- viaggio: a differenza di POI/itinerario/contatti, non va condivisa con
-- gli altri partecipanti (chiunque conosca l'endpoint potrebbe mandare
-- notifiche a quel dispositivo). Stessa logica "solo il proprietario"
-- della checklist, non quella "is_trip_member" di POI/itinerario/contatti.
-- notified_for: la data/ora di partenza (trips.prefs->>'departureAt') per
-- cui è già stato inviato l'avviso — evita di notificare due volte per lo
-- stesso volo e si azzera da sola quando l'utente cambia data (l'Edge
-- Function confronta sempre col valore attuale, non deve "resettare" nulla).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  notified_for text,
  created_at timestamp with time zone default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_all" on public.push_subscriptions;

create policy "push_subscriptions_all" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists push_subscriptions_trip_id_idx on public.push_subscriptions (trip_id);

-- La Edge Function che invia le notifiche gira con la service role key
-- (bypassa RLS per definizione, non le serve una policy dedicata) mentre
-- legge trip.prefs->>'departureAt' per sapere quando avvisare: nessuna
-- colonna nuova su trips, si appoggia allo stesso prefs jsonb già usato
-- per bagagli e preferenze.
