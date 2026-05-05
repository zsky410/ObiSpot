import { Router } from "express";
import { z } from "zod";
import { supabaseAdminClient } from "../lib/supabase.js";
import { ensureVenueDailySlots, isDateInRollingWindow } from "../lib/slotAutoSeed.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, uuidLikeSchema, validateQuery } from "../utils/validate.js";

export const slotsRouter = Router();

const slotsQuerySchema = z.object({
  date: z.iso.date(),
  venueId: uuidLikeSchema,
  pitchFormat: z.enum(["5v5", "7v7"]).optional()
});

slotsRouter.get(
  "/",
  validateQuery(slotsQuerySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid slots query params",
        { fields: req.validationError }
      );
    }
    const { date, venueId, pitchFormat } = req.validatedQuery;
    if (isDateInRollingWindow(date, 5)) {
      await ensureVenueDailySlots(supabaseAdminClient, {
        venueId,
        date,
        slotMinutes: 30,
        dailyStart: "05:00",
        dailyEnd: "23:00"
      });
    }

    const dayStart = new Date(`${date}T00:00:00+07:00`).toISOString();
    const dayEndExclusive = new Date(new Date(`${date}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();

    // Đọc trực tiếp time_slots (luôn có mọi cột mới như price_vnd). View available_slots + SELECT ts.*
    // trong Postgres không tự thêm cột sau ALTER TABLE → select price_vnd trên view có thể lỗi 500.
    // Mọi ô trùng ngày (+07): các slot giao với [dayStart, dayEndExclusive) (không chỉ start_time trong ngày).
    let slotQuery = supabaseAdminClient
      .from("time_slots")
      .select(
        "id, field_id, start_time, end_time, status, price_vnd, fields:field_id!inner(name, venue_id, price_per_slot, pitch_format)"
      )
      .eq("fields.venue_id", venueId)
      .lt("start_time", dayEndExclusive)
      .gt("end_time", dayStart);
    if (pitchFormat) {
      slotQuery = slotQuery.eq("fields.pitch_format", pitchFormat);
    }
    const { data: slotRows, error: slotsError } = await slotQuery.order("start_time", { ascending: true });

    if (slotsError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch slots");
    }

    const rows = slotRows || [];
    let bookedSlotIds = new Set();
    if (rows.length > 0) {
      const ids = rows.map((s) => s.id);
      const { data: bookingRows, error: bookingsError } = await supabaseAdminClient
        .from("bookings")
        .select("slot_id")
        .in("slot_id", ids)
        .in("status", ["pending", "confirmed"]);

      if (bookingsError) {
        return sendError(res, 500, ERROR_CODES.dbError, "Failed to resolve booked slots");
      }
      bookedSlotIds = new Set((bookingRows || []).map((b) => b.slot_id));
    }

    /** Khoảng đã bận (booking hoặc blocked) — client vẽ ô thời gian, tránh nhầm chỉ mốc biên slot với “còn trống”. */
    const busyRanges = rows
      .filter((s) => bookedSlotIds.has(s.id) || s.status === "blocked")
      .map((s) => ({
        fieldName: s.fields?.name || "",
        startTime: s.start_time,
        endTime: s.end_time
      }));

    const data = rows.filter((s) => s.status === "available" && !bookedSlotIds.has(s.id));

    const items = data.map((slot) => ({
      id: slot.id,
      fieldId: slot.field_id,
      fieldName: slot.fields?.name || "",
      pitchFormat: slot.fields?.pitch_format || "5v5",
      startTime: slot.start_time,
      endTime: slot.end_time,
      status: slot.status,
      pricePerSlot: Number(slot.price_vnd ?? slot.fields?.price_per_slot ?? 0)
    }));

    return res.status(200).json({ date, items, busyRanges });
  })
);
