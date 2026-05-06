alter table public.refund_requests
  add column if not exists beneficiary_bank_name text,
  add column if not exists beneficiary_account_number text,
  add column if not exists beneficiary_account_name text;
