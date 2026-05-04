import { Router } from "express";
import { randomUUID } from "node:crypto";
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
    const orderId = randomUUID();
    let firstCreatedAt = null;
    try {
      for (const sid of slotPkIds) {
        const { data: row, error: insErr } = await supabaseAdminClient
          .from("bookings")
          .insert({
            order_id: orderId,
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
      id: orderId,
      orderId,
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
    const { data: bookingRows, error: bookingError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id, status, created_at, note, slot_id")
      .eq("user_id", req.auth.user.id)
      .order("created_at", { ascending: false });

    if (bookingError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch user bookings");
    }

    const rows = bookingRows || [];
    const slotIds = [...new Set(rows.map((b) => b.slot_id).filter(Boolean))];

    const slotById = new Map();
    const venueById = new Map();

    if (slotIds.length > 0) {
      const { data: slotRows, error: slotError } = await supabaseAdminClient
        .from("time_slots")
        .select("id, start_time, end_time, price_vnd, fields ( name, venue_id )")
        .in("id", slotIds);

      if (slotError) {
        return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch booking slots");
      }

      for (const slot of slotRows || []) {
        slotById.set(slot.id, slot);
      }

      const venueIds = [
        ...new Set(
          (slotRows || [])
            .map((s) => {
              const f = Array.isArray(s.fields) ? s.fields[0] : s.fields;
              return f?.venue_id;
            })
            .filter(Boolean)
        )
      ];

      if (venueIds.length > 0) {
        const { data: venueRows, error: venueError } = await supabaseAdminClient
          .from("venues")
          .select("id, name, address")
          .in("id", venueIds);

        if (venueError) {
          return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch venues for bookings");
        }

        for (const v of venueRows || []) {
          venueById.set(v.id, v);
        }
      }
    }

    const orderMap = new Map();
    for (const booking of rows) {
      const key = booking.order_id || booking.id;
      const ts = slotById.get(booking.slot_id);
      const fieldRow = Array.isArray(ts?.fields) ? ts.fields[0] : ts?.fields;
      const venueId = fieldRow?.venue_id || null;
      const venueRow = venueId ? venueById.get(venueId) : null;
      const slotPrice = Number(ts?.price_vnd ?? 0);
      const slotStart = ts?.start_time ? new Date(ts.start_time).getTime() : null;
      const slotEnd = ts?.end_time ? new Date(ts.end_time).getTime() : null;

      const existing = orderMap.get(key);
      if (!existing) {
        orderMap.set(key, {
          id: key,
          status: booking.status,
          createdAt: booking.created_at || null,
          note: booking.note ?? null,
          slot: {
            id: ts?.id || null,
            startTime: ts?.start_time || null,
            endTime: ts?.end_time || null,
            fieldName: fieldRow?.name || "",
            pricePerSlot: slotPrice,
            slotCount: 1
          },
          venue: {
            id: venueId,
            name: venueRow?.name || "",
            address: venueRow?.address || ""
          }
        });
        continue;
      }

      if (slotStart !== null) {
        const currentStart = existing.slot.startTime ? new Date(existing.slot.startTime).getTime() : Number.POSITIVE_INFINITY;
        if (slotStart < currentStart) {
          existing.slot.startTime = ts.start_time;
          existing.slot.id = ts?.id || existing.slot.id;
        }
      }
      if (slotEnd !== null) {
        const currentEnd = existing.slot.endTime ? new Date(existing.slot.endTime).getTime() : Number.NEGATIVE_INFINITY;
        if (slotEnd > currentEnd) {
          existing.slot.endTime = ts.end_time;
        }
      }

      existing.slot.pricePerSlot += slotPrice;
      existing.slot.slotCount += 1;

      if (!existing.note && booking.note) {
        existing.note = booking.note;
      }
      if (booking.status === "pending" || existing.status === "pending") {
        existing.status = "pending";
      } else if (booking.status === "confirmed" || existing.status === "confirmed") {
        existing.status = "confirmed";
      } else {
        existing.status = "cancelled";
      }
    }

    const items = Array.from(orderMap.values()).sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    return res.status(200).json({ items });
  })
);
