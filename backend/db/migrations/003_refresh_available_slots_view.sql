-- View cũ dùng SELECT ts.* được expand tại thời điểm tạo; sau khi thêm cột (vd. price_vnd) có thể thiếu cột.
-- Làm mới định nghĩa cho đồng bộ schema (tool SQL / dashboard). Route API đã đọc time_slots trực tiếp.

create or replace view public.available_slots as
select ts.*
from public.time_slots ts
where ts.status = 'available'
  and not exists (
    select 1
    from public.bookings b
    where b.slot_id = ts.id
      and b.status in ('pending', 'confirmed')
  );
