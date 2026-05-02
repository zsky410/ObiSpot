-- Day 2 seed: chỉ tạo demo profiles (customer/admin).
-- Chi nhánh / sân / slot / booking demo dùng file `002_three_branches_reset.sql`.
--
-- Bước:
-- 1) Tạo user trong Supabase Auth trước.
-- 2) Thay UUID dưới đây khớp auth user IDs thực tế.

do $$
begin
  if not exists (select 1 from profiles where id = 'f6b185f0-36b2-497f-b30d-d15e0e985a0c') then
    insert into profiles (id, full_name, phone, role)
    values ('f6b185f0-36b2-497f-b30d-d15e0e985a0c', 'Demo Customer', '0900000001', 'customer');
  end if;

  if not exists (select 1 from profiles where id = '10f53249-81c1-43bc-9b08-1271a70f45ef') then
    insert into profiles (id, full_name, phone, role)
    values ('10f53249-81c1-43bc-9b08-1271a70f45ef', 'Demo Admin', '0900000002', 'admin');
  end if;
end $$;
