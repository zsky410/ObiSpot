import { app } from "./app.js";
import { env } from "./config/env.js";
import { expireUnpaidBookings } from "./routes/bookings.js";

app.listen(env.port, () => {
  console.log(`ObiSpot backend listening on port ${env.port}`);
});

expireUnpaidBookings().catch((error) => {
  console.error("Failed to expire stale unpaid bookings on startup", error);
});

const paymentExpiryTimer = setInterval(() => {
  expireUnpaidBookings().catch((error) => {
    console.error("Failed to expire stale unpaid bookings", error);
  });
}, 60 * 1000);

if (typeof paymentExpiryTimer.unref === "function") {
  paymentExpiryTimer.unref();
}
