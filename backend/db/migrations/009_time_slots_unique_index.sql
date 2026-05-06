-- Prevent duplicate slots for the same field/time range.
-- Existing duplicate rows should be cleaned before this migration is applied.
create unique index if not exists uniq_time_slots_field_start_end
  on public.time_slots (field_id, start_time, end_time);
