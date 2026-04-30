import { Router } from "express";
import { z } from "zod";
import { supabaseAdminClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, uuidLikeSchema, validateBody } from "../utils/validate.js";

export const bookingsRouter = Router();

const createBookingBodySchema = z.object({
  slotId: uuidLikeSchema,
  note: z.string().trim().max(300).optional()
});

bookingsRouter.post(
  "/",
  requireAuth,
  validateBody(createBookingBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid create booking body",
        { fields: req.validationError }
      );
    }
    const { slotId, note } = req.validatedBody;

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
        return sendError(
          res,
          409,
          ERROR_CODES.bookingConflict,
          "Slot is no longer available",
          { slotId }
        );
      }
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to create booking");
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
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch user bookings");
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
