-- Demo: 3 chi nhánh Đà Nẵng; mỗi chi nhánh 6 sân (3x 5v5: Sân 5A–5C, 3x 7v7: Sân 7A–7C).
-- Xóa booking & slot cũ; sinh slot 30 phút 05:00–22:30 (14 ngày từ “hôm nay” theo giờ VN).
-- Chạy sau migrations (005_fields_pitch_format.sql). Profiles giữ nguyên.

delete from bookings;
delete from time_slots;
delete from fields;
delete from venues;

insert into venues (id, name, address, open_time, close_time)
values
  (
    '11111111-1111-4111-a111-111111111101',
    'ObiSpot 1 - Chi nhánh Sơn Trà',
    '82 Hồ Nghinh, An Hải, Đà Nẵng 550000, Vietnam',
    '05:00',
    '23:00'
  ),
  (
    '11111111-1111-4111-a111-111111111102',
    'ObiSpot 2 - Chi nhánh Liên Chiểu',
    '41-39 Giáp Văn Cương, Hòa Khánh, Đà Nẵng 550000, Vietnam',
    '05:00',
    '23:00'
  ),
  (
    '11111111-1111-4111-a111-111111111103',
    'ObiSpot 3 - Chi nhánh Cẩm Lệ',
    '8 Đ. Nguyễn Nhàn, Cẩm Lệ, Đà Nẵng 550000, Vietnam',
    '05:00',
    '23:00'
  );

-- price_per_slot trên fields giữ 0; giá slot dùng price_vnd.
insert into fields (id, venue_id, name, price_per_slot, status, pitch_format)
values
  -- Chi nhánh 1
  ('22222222-2222-4222-a222-222222222201', '11111111-1111-4111-a111-111111111101', 'Sân 5A', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222202', '11111111-1111-4111-a111-111111111101', 'Sân 5B', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222203', '11111111-1111-4111-a111-111111111101', 'Sân 5C', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222204', '11111111-1111-4111-a111-111111111101', 'Sân 7A', 0, 'active', '7v7'),
  ('22222222-2222-4222-a222-222222222205', '11111111-1111-4111-a111-111111111101', 'Sân 7B', 0, 'active', '7v7'),
  ('22222222-2222-4222-a222-222222222206', '11111111-1111-4111-a111-111111111101', 'Sân 7C', 0, 'active', '7v7'),
  -- Chi nhánh 2
  ('22222222-2222-4222-a222-222222222207', '11111111-1111-4111-a111-111111111102', 'Sân 5A', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222208', '11111111-1111-4111-a111-111111111102', 'Sân 5B', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222209', '11111111-1111-4111-a111-111111111102', 'Sân 5C', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222210', '11111111-1111-4111-a111-111111111102', 'Sân 7A', 0, 'active', '7v7'),
  ('22222222-2222-4222-a222-222222222211', '11111111-1111-4111-a111-111111111102', 'Sân 7B', 0, 'active', '7v7'),
  ('22222222-2222-4222-a222-222222222212', '11111111-1111-4111-a111-111111111102', 'Sân 7C', 0, 'active', '7v7'),
  -- Chi nhánh 3
  ('22222222-2222-4222-a222-222222222213', '11111111-1111-4111-a111-111111111103', 'Sân 5A', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222214', '11111111-1111-4111-a111-111111111103', 'Sân 5B', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222215', '11111111-1111-4111-a111-111111111103', 'Sân 5C', 0, 'active', '5v5'),
  ('22222222-2222-4222-a222-222222222216', '11111111-1111-4111-a111-111111111103', 'Sân 7A', 0, 'active', '7v7'),
  ('22222222-2222-4222-a222-222222222217', '11111111-1111-4111-a111-111111111103', 'Sân 7B', 0, 'active', '7v7'),
  ('22222222-2222-4222-a222-222222222218', '11111111-1111-4111-a111-111111111103', 'Sân 7C', 0, 'active', '7v7');

insert into time_slots (field_id, start_time, end_time, status, price_vnd)
select
  f.id,
  s.slot_start,
  s.slot_end,
  'available',
  public.compute_slot_price_vnd(s.slot_start, s.slot_end)
from fields f
cross join (
  select generate_series(
    (current_timestamp at time zone 'Asia/Ho_Chi_Minh')::date,
    (current_timestamp at time zone 'Asia/Ho_Chi_Minh')::date + interval '13 days',
    interval '1 day'
  )::date as day_date
) d
cross join generate_series(0, 35) as gs(idx)
cross join lateral (
  select
    q.t0 as slot_start,
    q.t0 + interval '30 minutes' as slot_end
  from (
    select
      ((d.day_date + interval '5 hour')::timestamp at time zone 'Asia/Ho_Chi_Minh')
        + make_interval(mins => 30 * gs.idx) as t0
  ) q
) s;
