-- Loại sân: 5v5 | 7v7 — mỗi field gắn một loại; lọc slot theo query API.

alter table public.fields
  add column if not exists pitch_format text;

update public.fields
set pitch_format = '5v5'
where pitch_format is null;

alter table public.fields
  alter column pitch_format set default '5v5';

alter table public.fields
  alter column pitch_format set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fields_pitch_format_check'
      and conrelid = 'public.fields'::regclass
  ) then
    alter table public.fields
      add constraint fields_pitch_format_check
      check (pitch_format in ('5v5', '7v7'));
  end if;
end $$;

comment on column public.fields.pitch_format is 'Kích thước sân: 5v5 hoặc 7v7.';
