-- Lưu yêu cầu hủy đơn từ khách hàng; admin sẽ duyệt sau.
alter table public.bookings
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_request_note text,
  add column if not exists cancel_request_status text
    check (cancel_request_status in ('pending', 'approved', 'rejected'));

create index if not exists idx_bookings_cancel_request_status
  on public.bookings (cancel_request_status)
  where cancel_request_status is not null;
