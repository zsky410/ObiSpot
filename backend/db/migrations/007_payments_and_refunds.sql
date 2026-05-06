-- SePay payment gateway + refund workflow

alter table public.bookings
  add column if not exists payment_status text
    check (payment_status in ('awaiting', 'paid', 'expired', 'refunded')),
  add column if not exists payment_expires_at timestamptz,
  add column if not exists payment_paid_at timestamptz;

update public.bookings
set payment_status = 'awaiting'
where payment_status is null;

alter table public.bookings
  alter column payment_status set default 'awaiting';

create table if not exists public.payments (
  order_id uuid primary key,
  provider text not null default 'sepay_pg',
  amount_vnd integer not null check (amount_vnd >= 0),
  sepay_order_id text unique,
  invoice_number text not null unique,
  checkout_url text,
  return_success_url text,
  return_error_url text,
  return_cancel_url text,
  status text not null check (status in ('awaiting', 'paid', 'expired', 'refunded')) default 'awaiting',
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_status
  on public.payments (status);

create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  total_amount_vnd integer not null check (total_amount_vnd >= 0),
  fee_percent integer not null check (fee_percent in (0, 30)),
  refund_amount_vnd integer not null check (refund_amount_vnd >= 0),
  status text not null check (status in ('pending', 'approved', 'rejected', 'refunded')) default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  note text
);

create unique index if not exists uniq_refund_requests_order_id
  on public.refund_requests (order_id);

create index if not exists idx_refund_requests_status
  on public.refund_requests (status);

create table if not exists public.payment_webhook_events (
  id text primary key,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  matched_order_id uuid
);
