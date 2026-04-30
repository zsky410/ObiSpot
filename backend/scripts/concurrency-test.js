#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL || "http://localhost:4000/api/v1";
const USER_EMAIL = process.env.USER_EMAIL || "user@obispot.demo";
const USER_PASSWORD = process.env.USER_PASSWORD || "user";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@obispot.demo";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const VENUE_ID = process.env.VENUE_ID || "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PARALLEL_REQUESTS = Number(process.env.PARALLEL_REQUESTS || 10);

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_error) {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (result.status !== 200 || !result.body.accessToken) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(result.body)}`);
  }
  return result.body.accessToken;
}

function authHeader(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function pickAvailableSlot() {
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    const dateStr = date.toISOString().slice(0, 10);
    const result = await request(`/slots?date=${dateStr}&venueId=${VENUE_ID}`);
    if (result.status !== 200) {
      continue;
    }
    const slotId = result.body?.items?.[0]?.id;
    if (slotId) {
      return { date: dateStr, slotId };
    }
  }
  throw new Error("No available slot found in next 7 days");
}

async function run() {
  console.log(`Running concurrency test against ${BASE_URL}`);
  const userToken = await login(USER_EMAIL, USER_PASSWORD);
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const picked = await pickAvailableSlot();
  console.log(`Picked slot ${picked.slotId} on ${picked.date}`);

  const payload = JSON.stringify({
    slotId: picked.slotId,
    note: "concurrency-test"
  });

  const calls = Array.from({ length: PARALLEL_REQUESTS }, () =>
    request("/bookings", {
      method: "POST",
      headers: authHeader(userToken),
      body: payload
    })
  );

  const results = await Promise.all(calls);
  const success = results.filter((item) => item.status === 201);
  const conflicts = results.filter(
    (item) => item.status === 409 && item.body?.error?.code === "BOOKING_CONFLICT"
  );
  const unexpected = results.filter(
    (item) =>
      !(
        item.status === 201 ||
        (item.status === 409 && item.body?.error?.code === "BOOKING_CONFLICT")
      )
  );

  const summary = {
    totalRequests: PARALLEL_REQUESTS,
    success201: success.length,
    conflict409: conflicts.length,
    unexpectedCount: unexpected.length
  };

  console.log("Summary:", JSON.stringify(summary));

  if (success[0]?.body?.id) {
    const bookingId = success[0].body.id;
    const cleanup = await request(`/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: authHeader(adminToken),
      body: JSON.stringify({ status: "cancelled" })
    });
    if (cleanup.status === 200) {
      console.log(`Cleanup: cancelled booking ${bookingId}`);
    } else {
      console.log(`Cleanup failed: ${JSON.stringify(cleanup.body)}`);
    }
  }

  if (summary.success201 !== 1 || summary.conflict409 !== PARALLEL_REQUESTS - 1) {
    console.error("Concurrency expectation failed.");
    process.exit(1);
  }

  console.log("Concurrency test passed.");
}

run().catch((error) => {
  console.error("Concurrency test crashed:", error.message);
  process.exit(1);
});
