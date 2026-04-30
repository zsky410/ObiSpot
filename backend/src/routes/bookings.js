import { Router } from "express";
import { supabaseAdminClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, sendError } from "../utils/http.js";

export const bookingsRouter = Router();

bookingsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { slotId, note } = req.body || {};
    if (!slotId) {
      return sendError(res, 400, "VALIDATION_ERROR", "slotId is required");
    }

    const { data, error } = await supabaseAdminClient
      .from("bookings")
      .insert({
        user_id: req.auth.user.id,
        slot_id: slotId,
        note: note || null,
        status: "pending"
      })
      .select("id, status, slot_id, user_id, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return sendError(res, 409, "BOOKING_CONFLICT", "Slot is no longer available", { slotId });
      }
      return sendError(res, 500, "DB_ERROR", "Failed to create booking");
    }

    return res.status(201).json({
      id: data.id,
      status: data.status,
      slotId: data.slot_id,
      userId: data.user_id,
      createdAt: data.created_at
    });
  })
);

bookingsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdminClient
      .from("bookings")
      .select("id, status, time_slots:slot_id(id, start_time, fields:field_id(name))")
      .eq("user_id", req.auth.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return sendError(res, 500, "DB_ERROR", "Failed to fetch user bookings");
    }

    const items = (data || []).map((booking) => ({
      id: booking.id,
      status: booking.status,
      slot: {
        id: booking.time_slots?.id || null,
        startTime: booking.time_slots?.start_time || null,
        fieldName: booking.time_slots?.fields?.name || ""
      }
    }));

    return res.status(200).json({ items });
  })
);
