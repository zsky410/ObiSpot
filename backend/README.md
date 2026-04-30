# ObiSpot Backend (Day 2)

## Setup
1. Copy env:
   - `cp .env.example .env`
2. Install dependencies:
   - `npm install`
3. Run:
   - `npm run dev`

## SQL order
1. Run migration:
   - `backend/db/migrations/001_init.sql`
2. Create Supabase Auth users:
   - `customer@obispot.demo`
   - `admin@obispot.demo`
3. Replace UUID in `backend/db/seeds/001_demo_seed.sql` with real auth user IDs.
4. Run seed:
   - `backend/db/seeds/001_demo_seed.sql`

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
