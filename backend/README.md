# ObiSpot Backend (Day 2)

## Setup
1. Copy env:
   - `cp .env.example .env`
2. Install dependencies:
   - `npm install`
3. Run:
   - `npm run dev`

## SQL order
1. Run migrations (theo thứ tự):
   - `backend/db/migrations/001_init.sql`
   - `backend/db/migrations/002_time_slots_price_vnd.sql` (cột `price_vnd` + hàm `compute_slot_price_vnd`)
   - (Tuỳ chọn) `backend/db/migrations/003_refresh_available_slots_view.sql` — làm mới view `available_slots` sau khi thêm cột (API `/slots` đã đọc `time_slots` trực tiếp)
2. Create Supabase Auth users:
   - `customer@obispot.demo`
   - `admin@obispot.demo`
3. Replace UUID trong `backend/db/seeds/001_demo_seed.sql` bằng auth user IDs thực tế.
4. Run seeds:
   - `backend/db/seeds/001_demo_seed.sql` (profiles demo)
   - `backend/db/seeds/002_three_branches_reset.sql` — **xóa hết booking/slot/sân/chi nhánh cũ**, tạo 3 chi nhánh giả + slot trống 14 ngày (giá theo khung giờ VN).

Để reset lại dữ liệu demo chỉ cần chạy lại `002_three_branches_reset.sql` (sẽ xóa bookings và slots).

## API base
- `/api/v1`

## Implemented Day 2 endpoints
- `POST /api/v1/auth/login`
- `GET /api/v1/venues`
- `GET /api/v1/slots?date=YYYY-MM-DD&venueId=<uuid>`
- `POST /api/v1/bookings` (customer)
- `GET /api/v1/bookings/me` (customer)
- `GET /api/v1/admin/bookings` (admin)
- `PATCH /api/v1/admin/bookings/:bookingId` (admin)
- `PATCH /api/v1/admin/slots/:slotId` (admin)
