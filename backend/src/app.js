import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { venuesRouter } from "./routes/venues.js";
import { slotsRouter } from "./routes/slots.js";
import { bookingsRouter } from "./routes/bookings.js";
import { adminRouter } from "./routes/admin.js";
import { chatbotRouter } from "./routes/chatbot.js";
import { paymentsRouter } from "./routes/payments.js";
import { requestLogger } from "./middleware/logger.js";
import { supabaseAdminClient } from "./lib/supabase.js";
import { ERROR_CODES } from "./utils/errorCodes.js";
import { asyncHandler, sendError } from "./utils/http.js";

export const app = express();

app.use(
  cors({
    origin: true,
    credentials: false
  })
);
app.use(express.json());
app.use(requestLogger);

app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const { error } = await supabaseAdminClient.from("venues").select("id").limit(1);
    if (error) {
      return sendError(res, 503, ERROR_CODES.dbError, "Database health check failed");
    }
    return res.status(200).json({ ok: true, db: "up" });
  })
);

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/venues", venuesRouter);
app.use("/api/v1/slots", slotsRouter);
app.use("/api/v1/bookings", bookingsRouter);
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/chatbot", chatbotRouter);

app.use((_req, res) => {
  return sendError(res, 404, ERROR_CODES.notFound, "Route not found");
});

app.use((err, _req, res, _next) => {
  // Keep unknown errors in a unified response shape for clients.
  console.error(err);
  return sendError(res, 500, ERROR_CODES.internalError, "Unexpected server error");
});
