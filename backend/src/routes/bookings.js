import { Router } from "express";
import { z } from "zod";
import { supabaseAdminClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, uuidLikeSchema, validateBody } from "../utils/validate.js";

export const bookingsRouter = Router();

const createBookingBodySchema = z
  .object({
    slotId: uuidLikeSchema.optional(),
    slotIds: z.array(uuidLikeSchema).min(1).max(48).optional(),
    note: z.string().trim().max(300).optional().nullable()
  })
  .refine(
    (d) =>
      Boolean(d.slotId) !== Boolean(d.slotIds && d.slotIds.length > 0),
    {
      message: "Gửi đúng một trong hai: slotId (một slot) hoặc slotIds (danh sách)",
      path: ["slotId"]
    }
  );

function slotInstantMs(iso) {
  return new Date(iso).getTime();
}

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

    const { slotId, slotIds: slotIdsRaw, note } = req.validatedBody;
    const uniqueIds = [...new Set(slotIdsRaw ?? [slotId])];

    const { data: slotRows, error: slotsReadError } = await supabaseAdminClient
      .from("time_slots")
      .select("id, field_id, start_time, end_time, status")
      .in("id", uniqueIds);

    if (slotsReadError || !slotRows || slotRows.length !== uniqueIds.length) {
      return sendError(res, 400, ERROR_CODES.validationError, "One or more slots are invalid", {
        slotIds: uniqueIds
      });
    }

    const sorted = [...slotRows].sort((a, b) => slotInstantMs(a.start_time) - slotInstantMs(b.start_time));

    const fieldId = sorted[0].field_id;
    if (sorted.some((s) => s.field_id !== fieldId)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "All slots must belong to the same field",
        { slotIds: uniqueIds }
      );
    }

    if (sorted.some((s) => s.status !== "available")) {
      return sendError(res, 409, ERROR_CODES.bookingConflict, "One or more slots are not available", {
        slotIds: uniqueIds
      });
    }

    for (let i = 1; i < sorted.length; i++) {
      if (slotInstantMs(sorted[i].start_time) !== slotInstantMs(sorted[i - 1].end_time)) {
        return sendError(res, 400, ERROR_CODES.validationError, "Slots must form one contiguous range", {
          slotIds: uniqueIds
        });
      }
    }

    const slotPkIds = sorted.map((s) => s.id);
    const { data: blocking, error: blockErr } = await supabaseAdminClient
      .from("bookings")
      .select("slot_id")
      .in("slot_id", slotPkIds)
      .in("status", ["pending", "confirmed"]);

    if (blockErr) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to verify slot availability");
    }
    if (blocking && blocking.length > 0) {
      return sendError(res, 409, ERROR_CODES.bookingConflict, "One or more slots are already booked", {
        slotIds: blocking.map((b) => b.slot_id)
      });
    }

    const createdIds = [];
    let firstCreatedAt = null;
    try {
      for (const sid of slotPkIds) {
        const { data: row, error: insErr } = await supabaseAdminClient
          .from("bookings")
          .insert({
            user_id: req.auth.user.id,
            slot_id: sid,
            note: note || null,
            status: "pending"
          })
          .select("id, status, slot_id, user_id, created_at")
          .single();

        if (insErr) {
          if (insErr.code === "23505") {
            throw Object.assign(new Error("conflict"), { code: "23505", pg: insErr });
          }
          throw Object.assign(new Error("insert"), { pg: insErr });
        }
        createdIds.push(row.id);
        if (!firstCreatedAt) {
          firstCreatedAt = row.created_at;
        }
      }
    } catch (e) {
      if (createdIds.length > 0) {
        await supabaseAdminClient.from("bookings").delete().in("id", createdIds);
      }
      if (e?.code === "23505") {
        return sendError(
          res,
          409,
          ERROR_CODES.bookingConflict,
          "Slot is no longer available",
          { slotIds: slotPkIds }
        );
      }
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to create booking");
    }

    const firstRow = sorted[0];
    const lastRow = sorted[sorted.length - 1];

    return res.status(201).json({
      id: createdIds[0],
      bookingIds: createdIds,
      slotIds: slotPkIds,
      status: "pending",
      userId: req.auth.user.id,
      createdAt: firstCreatedAt,
      rangeStart: firstRow.start_time,
      rangeEnd: lastRow.end_time
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
