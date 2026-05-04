/**
 * Xóa toàn bộ hàng trong public.bookings (giải phóng slot để test đặt lịch lại).
 * Chạy: từ thư mục backend — node scripts/clear-bookings.js
 * Yêu cầu SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY trong backend/.env
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong backend/.env");
  process.exit(1);
}

const supabase = createClient(url, key);

const { error } = await supabase.from("bookings").delete().gte("created_at", "1970-01-01T00:00:00Z");

if (error) {
  console.error("Không xóa được bookings:", error.message);
  process.exit(1);
}

console.log("Đã xóa toàn bộ bookings. Slot khả dụng trở lại để test.");
