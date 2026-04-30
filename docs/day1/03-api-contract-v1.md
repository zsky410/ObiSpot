# ObiSpot API Contract v1 (Day 1)

Base URL: `/api/v1`

## Error format (ap dung cho tat ca endpoint)
```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "Slot is no longer available",
    "details": {}
  }
}
```

## Auth

### POST `/auth/login`
- Purpose: customer/admin login, backend verify Supabase JWT.
- Request:
```json
{
  "email": "customer@obispot.demo",
  "password": "demo1234"
}
```
- Response 200:
```json
{
  "accessToken": "jwt",
  "user": {
    "id": "uuid",
    "fullName": "Demo Customer",
    "role": "customer"
  }
}
```

## Venues and slots

### GET `/venues`
- Purpose: list venue + fields summary.
- Response 200:
```json
{
  "items": [
    {
      "id": "venue-uuid",
      "name": "ObiSport Center",
      "address": "Quan 7, TP.HCM"
    }
  ]
}
```

### GET `/slots?date=2026-05-01&venueId=venue-uuid`
- Purpose: list available/blocked slots for browsing.
- Rule: slot da co booking `pending|confirmed` khong tra ve trong available set.
- Response 200:
```json
{
  "date": "2026-05-01",
  "items": [
    {
      "id": "slot-uuid",
      "fieldId": "field-uuid",
      "fieldName": "San 7 nguoi A",
      "startTime": "2026-05-01T11:00:00+07:00",
      "endTime": "2026-05-01T12:30:00+07:00",
      "status": "available",
      "pricePerSlot": 600000
    }
  ]
}
```

## Booking flow

### POST `/bookings`
- Auth: customer.
- Request:
```json
{
  "slotId": "slot-uuid",
  "note": "Can muon bong"
}
```
- Response 201:
```json
{
  "id": "booking-uuid",
  "status": "pending",
  "slotId": "slot-uuid",
  "userId": "user-uuid",
  "createdAt": "2026-05-01T10:00:00Z"
}
```
- Response 409:
```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "Slot is no longer available",
    "details": {
      "slotId": "slot-uuid"
    }
  }
}
```

### GET `/bookings/me`
- Auth: customer.
- Response 200:
```json
{
  "items": [
    {
      "id": "booking-uuid",
      "status": "confirmed",
      "slot": {
        "id": "slot-uuid",
        "startTime": "2026-05-01T11:00:00+07:00",
        "fieldName": "San 7 nguoi A"
      }
    }
  ]
}
```

## Admin endpoints

### GET `/admin/bookings?date=2026-05-01&status=pending`
- Auth: admin only.
- Response 200: danh sach booking theo filter.

### PATCH `/admin/bookings/{bookingId}`
- Auth: admin only.
- Request:
```json
{
  "status": "confirmed"
}
```
- Rule:
  - Cho phep `pending -> confirmed|cancelled`.
  - Khong cho phep transition nguoc.

### PATCH `/admin/slots/{slotId}`
- Auth: admin only.
- Request:
```json
{
  "status": "blocked"
}
```

## Chatbot

### POST `/chatbot/query`
- Auth: customer.
- Purpose: FAQ + goi y slot retrieval-first.
- Request:
```json
{
  "message": "Toi mai con san 7 nguoi khong?"
}
```
- Response 200:
```json
{
  "reply": "Toi mai con 2 slot san 7 nguoi luc 19:00 va 20:30.",
  "source": "db+llm",
  "suggestions": [
    "Ban muon dat slot 19:00 khong?"
  ]
}
```
- Response 200 (fallback):
```json
{
  "reply": "He thong chat dang ban. Ban co the xem slot trong tai man hinh Dat san.",
  "source": "fallback"
}
```
