-- Xóa toàn bộ đặt lịch; không đụng venues/fields/time_slots/chat_logs/profiles.
-- Chạy trong Supabase SQL Editor hoặc: psql "$DATABASE_URL" -f backend/db/scripts/clear_bookings.sql
delete from public.bookings;
