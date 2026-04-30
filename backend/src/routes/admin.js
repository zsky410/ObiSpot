import { Router } from "express";
import { z } from "zod";
import { supabaseAdminClient } from "../lib/supabase.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import {
  hasValidationError,
  uuidLikeSchema,
  validateBody,
  validateParams,
  validateQuery
} from "../utils/validate.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

const adminBookingsQuerySchema = z.object({
  date: z.iso.date().optional(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional()
});
const bookingParamsSchema = z.object({
  bookingId: uuidLikeSchema
});
const updateBookingBodySchema = z.object({
  status: z.enum(["confirmed", "cancelled"])
});
const slotParamsSchema = z.object({
  slotId: uuidLikeSchema
});
const updateSlotBodySchema = z.object({
  status: z.enum(["available", "blocked"])
});

adminRouter.get(
  "/bookings",
  validateQuery(adminBookingsQuerySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid admin bookings query params",
        { fields: req.validationError }
      );
    }
    const { date, status } = req.validatedQuery;
    let query = supabaseAdminClient
      .from("bookings")
      .select("id, status, created_at, user_id, slot_id, time_slots:slot_id(start_time)");

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch admin bookings");
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
  validateParams(bookingParamsSchema),
  validateBody(updateBookingBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid update booking request",
        { fields: req.validationError }
      );
    }
    const { bookingId } = req.validatedParams;
    const { status } = req.validatedBody;

    const { data: current, error: currentError } = await supabaseAdminClient
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (currentError || !current) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Booking not found");
    }

    if (current.status !== "pending") {
      return sendError(
        res,
        409,
        ERROR_CODES.invalidStatusTransition,
        "Only pending booking can be updated"
      );
    }

    const { data, error } = await supabaseAdminClient
      .from("bookings")
      .update({ status })
      .eq("id", bookingId)
      .select("id, status, slot_id, user_id, created_at")
      .single();

    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to update booking");
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
  validateParams(slotParamsSchema),
  validateBody(updateSlotBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid update slot request",
        { fields: req.validationError }
      );
    }
    const { slotId } = req.validatedParams;
    const { status } = req.validatedBody;

    const { data, error } = await supabaseAdminClient
      .from("time_slots")
      .update({ status })
      .eq("id", slotId)
      .select("id, field_id, start_time, end_time, status")
      .maybeSingle();

    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to update slot status");
    }
    if (!data) {
      return sendError(res, 404, ERROR_CODES.slotNotFound, "Slot not found");
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
