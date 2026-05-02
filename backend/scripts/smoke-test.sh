#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000/api/v1}"
USER_EMAIL="${USER_EMAIL:-user@obispot.demo}"
USER_PASSWORD="${USER_PASSWORD:-user}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@obispot.demo}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
VENUE_ID="${VENUE_ID:-11111111-1111-4111-a111-111111111101}"

echo "[1/7] Health"
curl -fsS "${BASE_URL%/api/v1}/health" >/dev/null
echo "  OK"

echo "[2/7] Login user/admin"
USER_LOGIN=$(curl -fsS -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\"}")
ADMIN_LOGIN=$(curl -fsS -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
USER_TOKEN=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["accessToken"])' "$USER_LOGIN")
ADMIN_TOKEN=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["accessToken"])' "$ADMIN_LOGIN")
echo "  OK"

echo "[3/7] List venues/slots"
curl -fsS "$BASE_URL/venues" >/dev/null
SLOT_ID=""
for offset in 0 1 2 3 4 5 6 7; do
  TRY_DATE=$(date -d "+$offset day" +%F)
  SLOTS=$(curl -fsS "$BASE_URL/slots?date=$TRY_DATE&venueId=$VENUE_ID")
  SLOT_ID=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["items"][0]["id"] if d.get("items") else "")' "$SLOTS")
  if [ -n "$SLOT_ID" ]; then
    PICKED_DATE="$TRY_DATE"
    break
  fi
done
if [ -z "$SLOT_ID" ]; then
  echo "  FAIL: no available slot in next 7 days"
  exit 1
fi
echo "  OK (date=$PICKED_DATE slot=$SLOT_ID)"

echo "[4/7] Create booking"
CREATE_1=$(curl -sS -X POST "$BASE_URL/bookings" -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" -d "{\"slotId\":\"$SLOT_ID\",\"note\":\"smoke-test\"}")
BOOKING_ID=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get("id",""))' "$CREATE_1")
if [ -z "$BOOKING_ID" ]; then
  echo "  FAIL: create booking failed"
  echo "$CREATE_1"
  exit 1
fi
echo "  OK (booking=$BOOKING_ID)"

echo "[5/7] Conflict booking (expect 409)"
CREATE_2=$(curl -sS -X POST "$BASE_URL/bookings" -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" -d "{\"slotId\":\"$SLOT_ID\",\"note\":\"smoke-test-conflict\"}")
ERR_CODE=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get("error",{}).get("code",""))' "$CREATE_2")
if [ "$ERR_CODE" != "BOOKING_CONFLICT" ]; then
  echo "  FAIL: expected BOOKING_CONFLICT"
  echo "$CREATE_2"
  exit 1
fi
echo "  OK"

echo "[6/7] Admin confirm booking"
CONFIRM=$(curl -fsS -X PATCH "$BASE_URL/admin/bookings/$BOOKING_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"confirmed"}')
CONFIRMED_STATUS=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get("status",""))' "$CONFIRM")
if [ "$CONFIRMED_STATUS" != "confirmed" ]; then
  echo "  FAIL: confirm booking failed"
  echo "$CONFIRM"
  exit 1
fi
echo "  OK"

echo "[7/7] Verify my bookings"
ME=$(curl -fsS "$BASE_URL/bookings/me" -H "Authorization: Bearer $USER_TOKEN")
TOTAL=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(len(d.get("items",[])))' "$ME")
echo "  OK (total bookings=$TOTAL)"

echo "Smoke test passed."
