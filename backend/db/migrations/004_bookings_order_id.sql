-- Gom nhiều slot trong một lần đặt thành 1 "đơn" logic qua order_id.
-- Mỗi dòng bookings vẫn giữ 1 slot_id để không phá unique index chống double booking.

alter table public.bookings
  add column if not exists order_id uuid;

update public.bookings
set order_id = id
where order_id is null;

alter table public.bookings
  alter column order_id set not null;

create index if not exists idx_bookings_order_id
  on public.bookings (order_id);
