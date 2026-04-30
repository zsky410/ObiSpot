import express from "express";
import { authRouter } from "./routes/auth.js";
import { venuesRouter } from "./routes/venues.js";
import { slotsRouter } from "./routes/slots.js";
import { bookingsRouter } from "./routes/bookings.js";
import { adminRouter } from "./routes/admin.js";
import { sendError } from "./utils/http.js";

export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/venues", venuesRouter);
app.use("/api/v1/slots", slotsRouter);
app.use("/api/v1/bookings", bookingsRouter);
app.use("/api/v1/admin", adminRouter);

app.use((_req, res) => {
  return sendError(res, 404, "NOT_FOUND", "Route not found");
});

app.use((err, _req, res, _next) => {
  // Keep unknown errors in a unified response shape for clients.
  console.error(err);
  return sendError(res, 500, "INTERNAL_ERROR", "Unexpected server error");
});
