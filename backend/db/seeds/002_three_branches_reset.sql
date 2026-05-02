-- Demo UI A-Z: 3 chi nhánh giả địa chỉ, xóa hết booking & slot cũ, sinh slot 30 phút 05:00–22:30 (14 ngày từ “hôm nay” theo giờ VN).
-- Chạy sau migrations (002_time_slots_price_vnd.sql). Profiles giữ nguyên — không đụng bảng profiles.

delete from bookings;
delete from time_slots;
delete from fields;
delete from venues;

insert into venues (id, name, address, open_time, close_time)
values
  (
    '11111111-1111-4111-a111-111111111101',
    'ObiSpot Chi nhánh Quận 1',
    '123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP.HCM',
    '05:00',
    '23:00'
  ),
  (
    '11111111-1111-4111-a111-111111111102',
    'ObiSpot Chi nhánh Thủ Đức',
    '456 Võ Văn Ngân, TP. Thủ Đức, TP.HCM',
    '05:00',
    '23:00'
  ),
  (
    '11111111-1111-4111-a111-111111111103',
    'ObiSpot Chi nhánh Bình Thạnh',
    '789 Đinh Bộ Lĩnh, Phường 26, Quận Bình Thạnh, TP.HCM',
    '05:00',
    '23:00'
  );

-- price_per_slot trên fields không dùng cho hiển thị slot khi đã có price_vnd (giữ 0 cho đơn giản).
insert into fields (id, venue_id, name, price_per_slot, status)
values
  ('22222222-2222-4222-a222-222222222201', '11111111-1111-4111-a111-111111111101', 'Sân A1', 0, 'active'),
  ('22222222-2222-4222-a222-222222222202', '11111111-1111-4111-a111-111111111101', 'Sân A2', 0, 'active'),
  ('22222222-2222-4222-a222-222222222203', '11111111-1111-4111-a111-111111111101', 'Sân A3', 0, 'active'),
  ('22222222-2222-4222-a222-222222222204', '11111111-1111-4111-a111-111111111102', 'Sân B1', 0, 'active'),
  ('22222222-2222-4222-a222-222222222205', '11111111-1111-4111-a111-111111111102', 'Sân B2', 0, 'active'),
  ('22222222-2222-4222-a222-222222222206', '11111111-1111-4111-a111-111111111102', 'Sân B3', 0, 'active'),
  ('22222222-2222-4222-a222-222222222207', '11111111-1111-4111-a111-111111111103', 'Sân C1', 0, 'active'),
  ('22222222-2222-4222-a222-222222222208', '11111111-1111-4111-a111-111111111103', 'Sân C2', 0, 'active'),
  ('22222222-2222-4222-a222-222222222209', '11111111-1111-4111-a111-111111111103', 'Sân C3', 0, 'active');

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
