-- Day 2 seed: venue/field/slot + demo booking states
-- NOTE:
-- 1) Create demo users in Supabase Auth first.
-- 2) Replace profile UUIDs below to match actual auth user IDs.

-- Demo profile IDs (replace with real auth user IDs)
-- customer@obispot.demo
-- admin@obispot.demo
do $$
begin
  if not exists (select 1 from profiles where id = 'f6b185f0-36b2-497f-b30d-d15e0e985a0c') then
    insert into profiles (id, full_name, phone, role)
    values ('f6b185f0-36b2-497f-b30d-d15e0e985a0c', 'Demo Customer', '0900000001', 'customer');
  end if;

  if not exists (select 1 from profiles where id = '10f53249-81c1-43bc-9b08-1271a70f45ef') then
    insert into profiles (id, full_name, phone, role)
    values ('10f53249-81c1-43bc-9b08-1271a70f45ef', 'Demo Admin', '0900000002', 'admin');
  end if;
end $$;

insert into venues (id, name, address, open_time, close_time)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ObiSport Center', 'Quan 7, TP.HCM', '06:00', '23:00')
on conflict (id) do update
set
  name = excluded.name,
  address = excluded.address,
  open_time = excluded.open_time,
  close_time = excluded.close_time;

insert into fields (id, venue_id, name, price_per_slot, status)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'San 7 nguoi A', 600000, 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'San 7 nguoi B', 650000, 'active')
on conflict (id) do update
set
  name = excluded.name,
  price_per_slot = excluded.price_per_slot,
  status = excluded.status;

insert into time_slots (id, field_id, start_time, end_time, status)
values
  ('cccccccc-cccc-cccc-cccc-cccccccccc01', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', now() + interval '2 hour', now() + interval '3 hour 30 minute', 'available'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc02', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', now() + interval '4 hour', now() + interval '5 hour 30 minute', 'available'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc03', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', now() + interval '6 hour', now() + interval '7 hour 30 minute', 'blocked'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc04', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', now() + interval '1 day 2 hour', now() + interval '1 day 3 hour 30 minute', 'available'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc05', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', now() + interval '1 day 4 hour', now() + interval '1 day 5 hour 30 minute', 'available')
on conflict (id) do update
set
  status = excluded.status,
  start_time = excluded.start_time,
  end_time = excluded.end_time;

insert into bookings (id, user_id, slot_id, status, note)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddd01', 'f6b185f0-36b2-497f-b30d-d15e0e985a0c', 'cccccccc-cccc-cccc-cccc-cccccccccc02', 'pending', 'Demo pending booking'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd02', 'f6b185f0-36b2-497f-b30d-d15e0e985a0c', 'cccccccc-cccc-cccc-cccc-cccccccccc04', 'confirmed', 'Demo confirmed booking')
on conflict (id) do update
set
  status = excluded.status,
  note = excluded.note;
