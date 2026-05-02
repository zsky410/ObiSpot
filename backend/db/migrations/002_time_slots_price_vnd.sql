-- Giá mỗi slot (VND, đã là tổng cho khung start-end). Theo khung giờ giờ Việt Nam (Asia/Ho_Chi_Minh).

alter table public.time_slots
  add column if not exists price_vnd numeric(12, 2) not null default 0;

comment on column public.time_slots.price_vnd is 'Tổng tiền slot (VNĐ), tính theo phút và giá/giờ theo khung giờ địa phương.';

create or replace function public.compute_slot_price_vnd(p_start timestamptz, p_end timestamptz)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_t timestamptz;
  v_local timestamp;
  v_m int;
  v_rate numeric;
begin
  if p_end <= p_start then
    return 0;
  end if;

  v_t := p_start;
  while v_t < p_end loop
    v_local := v_t at time zone 'Asia/Ho_Chi_Minh';
    v_m :=
      extract(hour from v_local)::int * 60
      + extract(minute from v_local)::int;
    v_rate := case
      when v_m >= 5 * 60 and v_m < 8 * 60 then 80000
      when v_m >= 8 * 60 and v_m < 16 * 60 then 60000
      when v_m >= 16 * 60 and v_m < 20 * 60 then 100000
      when v_m >= 20 * 60 and v_m < 23 * 60 then 120000
      else 80000
    end;
    v_total := v_total + v_rate / 60.0;
    v_t := v_t + interval '1 minute';
  end loop;

  return round(v_total, 0);
end;
$$;
