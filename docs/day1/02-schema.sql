-- ObiSpot Day 1 - Initial schema and constraints
-- Source of truth for booking availability: bookings table.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key,
  full_name text not null,
  phone text,
  role text not null check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  open_time time not null,
  close_time time not null,
  created_at timestamptz not null default now()
);

create table if not exists fields (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  price_per_slot numeric(12,2) not null check (price_per_slot >= 0),
  status text not null check (status in ('active', 'inactive')) default 'active',
  created_at timestamptz not null default now()
);

create table if not exists time_slots (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references fields(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null check (status in ('available', 'blocked')) default 'available',
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  slot_id uuid not null references time_slots(id) on delete cascade,
  status text not null check (status in ('pending', 'confirmed', 'cancelled')) default 'pending',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  message text not null,
  response text not null,
  created_at timestamptz not null default now()
);

-- Prevent double-booking for active booking states.
create unique index if not exists uniq_active_booking_per_slot
  on bookings (slot_id)
  where status in ('pending', 'confirmed');

create index if not exists idx_time_slots_field_start
  on time_slots (field_id, start_time);

create index if not exists idx_bookings_user_created
  on bookings (user_id, created_at desc);

create index if not exists idx_bookings_slot_status
  on bookings (slot_id, status);

-- Optional helper view for available slot query in API layer.
create or replace view available_slots as
select ts.*
from time_slots ts
where ts.status = 'available'
  and not exists (
    select 1
    from bookings b
    where b.slot_id = ts.id
      and b.status in ('pending', 'confirmed')
  );
