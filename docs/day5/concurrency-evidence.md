# Day 5 Concurrency Evidence

## Command

```bash
cd backend
npm run concurrency:test
```

## Output

```text
> obispot-backend@0.1.0 concurrency:test
> node scripts/concurrency-test.js

Running concurrency test against http://localhost:4000/api/v1
Picked slot 64a9ee06-f95e-4488-b8a0-a4146f95af43 on 2026-05-01
Summary: {"totalRequests":10,"success201":1,"conflict409":9,"unexpectedCount":0}
Cleanup: cancelled booking 1ab8f717-21da-4ecb-8976-14303ca89b68
Concurrency test passed.
```

## Validation

- Expected result:
  - `201`: 1 request
  - `409 BOOKING_CONFLICT`: 9 requests
- Actual result: matched expected.
- Cleanup: successful (`pending` booking created by test was cancelled).
