import { Router } from "express";
import { supabaseAdminClient } from "../lib/supabase.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { asyncHandler, sendError } from "../utils/http.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const { date, status } = req.query;
    let query = supabaseAdminClient
      .from("bookings")
      .select("id, status, created_at, user_id, slot_id, time_slots:slot_id(start_time)");

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      return sendError(res, 500, "DB_ERROR", "Failed to fetch admin bookings");
    }

    let items = (data || []).map((item) => ({
      id: item.id,
      status: item.status,
      createdAt: item.created_at,
      userId: item.user_id,
      slotId: item.slot_id,
      slotStartTime: item.time_slots?.start_time || null
    }));

    if (date) {
      items = items.filter((item) => {
        if (!item.slotStartTime) {
          return false;
        }
        const slotDate = new Date(item.slotStartTime).toISOString().slice(0, 10);
        return slotDate === date;
      });
    }

    return res.status(200).json({ items });
  })
);

adminRouter.patch(
  "/bookings/:bookingId",
  asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    const { status } = req.body || {};
    if (!["confirmed", "cancelled"].includes(status)) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "status must be either confirmed or cancelled"
      );
    }

    const { data: current, error: currentError } = await supabaseAdminClient
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (currentError || !current) {
      return sendError(res, 404, "BOOKING_NOT_FOUND", "Booking not found");
    }

    if (current.status !== "pending") {
      return sendError(res, 409, "INVALID_STATUS_TRANSITION", "Only pending booking can be updated");
    }

    const { data, error } = await supabaseAdminClient
      .from("bookings")
      .update({ status })
      .eq("id", bookingId)
      .select("id, status, slot_id, user_id, created_at")
      .single();

    if (error) {
      return sendError(res, 500, "DB_ERROR", "Failed to update booking");
    }

    return res.status(200).json({
      id: data.id,
      status: data.status,
      slotId: data.slot_id,
      userId: data.user_id,
      createdAt: data.created_at
    });
  })
);

adminRouter.patch(
  "/slots/:slotId",
  asyncHandler(async (req, res) => {
    const { slotId } = req.params;
    const { status } = req.body || {};
    if (!["available", "blocked"].includes(status)) {
      return sendError(res, 400, "VALIDATION_ERROR", "status must be either available or blocked");
    }

    const { data, error } = await supabaseAdminClient
      .from("time_slots")
      .update({ status })
      .eq("id", slotId)
      .select("id, field_id, start_time, end_time, status")
      .maybeSingle();

    if (error) {
      return sendError(res, 500, "DB_ERROR", "Failed to update slot status");
    }
    if (!data) {
      return sendError(res, 404, "SLOT_NOT_FOUND", "Slot not found");
    }

    return res.status(200).json({
      id: data.id,
      fieldId: data.field_id,
      startTime: data.start_time,
      endTime: data.end_time,
      status: data.status
    });
  })
);
