import { Router } from "express";
import { z } from "zod";
import { supabaseAdminClient } from "../lib/supabase.js";
import { buildSlotKey, ensureVenueDailySlots } from "../lib/slotAutoSeed.js";
import { selectAllPages } from "../lib/supabasePaginate.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, uuidLikeSchema, validateQuery } from "../utils/validate.js";

export const slotsRouter = Router();

const slotsQuerySchema = z.object({
  date: z.iso.date(),
  venueId: uuidLikeSchema,
  pitchFormat: z.enum(["5v5", "7v7"]).optional()
});

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function fetchBookedSlotIds(slotIds) {
  const uniqueIds = [...new Set(slotIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { data: [], error: null };
  }

  const bookedSlotIds = new Set();
  for (const ids of chunk(uniqueIds, 200)) {
    const { data: bookingRows, error } = await selectAllPages(
      () =>
        supabaseAdminClient
          .from("bookings")
          .select("slot_id")
          .in("slot_id", ids)
          .in("status", ["pending", "confirmed"]),
      { pageSize: 1000 }
    );

    if (error) {
      return { data: null, error };
    }

    for (const booking of bookingRows || []) {
      if (booking?.slot_id) {
        bookedSlotIds.add(booking.slot_id);
      }
    }
  }

  return { data: [...bookedSlotIds], error: null };
}

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
    await ensureVenueDailySlots(supabaseAdminClient, {
      venueId,
      date,
      slotMinutes: 30,
      dailyStart: "05:00",
      dailyEnd: "23:00"
    });

    const rangeStart = new Date(`${date}T05:00:00+07:00`).toISOString();
    const rangeEndExclusive = new Date(`${date}T23:00:00+07:00`).toISOString();

    // Đọc trực tiếp time_slots (luôn có mọi cột mới như price_vnd). View available_slots + SELECT ts.*
    // trong Postgres không tự thêm cột sau ALTER TABLE → select price_vnd trên view có thể lỗi 500.
    // Mọi ô trùng ngày (+07): các slot giao với [dayStart, dayEndExclusive) (không chỉ start_time trong ngày).
    const { data: slotRows, error: slotsError } = await selectAllPages(() => {
      let slotQuery = supabaseAdminClient
        .from("time_slots")
        .select(
          "id, field_id, start_time, end_time, status, price_vnd, fields:field_id!inner(name, venue_id, price_per_slot, pitch_format)"
        )
        .eq("fields.venue_id", venueId)
      .gte("start_time", rangeStart)
      .lt("start_time", rangeEndExclusive);
      if (pitchFormat) {
        slotQuery = slotQuery.eq("fields.pitch_format", pitchFormat);
      }
      return slotQuery
        .order("field_id", { ascending: true })
        .order("start_time", { ascending: true })
        .order("id", { ascending: true });
    });

    if (slotsError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch slots");
    }

    const rows = slotRows || [];
    let bookedSlotIds = new Set();
    if (rows.length > 0) {
      const ids = rows.map((s) => s.id);
      const { data: bookedIds, error: bookingsError } = await fetchBookedSlotIds(ids);
      if (bookingsError) {
        return sendError(res, 500, ERROR_CODES.dbError, "Failed to resolve booked slots");
      }
      bookedSlotIds = new Set(bookedIds || []);
    }

    const groupedBySlotKey = new Map();
    for (const row of rows) {
      const key = buildSlotKey(row.field_id, row.start_time, row.end_time);
      const group = groupedBySlotKey.get(key);
      if (group) {
        group.push(row);
      } else {
        groupedBySlotKey.set(key, [row]);
      }
    }

    const uniqueSlots = [];
    for (const siblings of groupedBySlotKey.values()) {
      const hasBookedSibling = siblings.some((candidate) => bookedSlotIds.has(candidate.id));
      const blockedSibling = siblings.find((candidate) => candidate.status === "blocked");
      const availableSibling = siblings.find((candidate) => candidate.status === "available");
      const representative = blockedSibling || availableSibling || siblings[0];
      uniqueSlots.push({
        ...representative,
        effectiveStatus: hasBookedSibling ? "booked" : blockedSibling ? "blocked" : representative.status
      });
    }

    /** Khoảng đã bận (booking hoặc blocked) — client vẽ ô thời gian, tránh nhầm chỉ mốc biên slot với “còn trống”. */
    const busyRanges = uniqueSlots
      .filter((s) => s.effectiveStatus === "booked" || s.effectiveStatus === "blocked")
      .map((s) => ({
        fieldName: s.fields?.name || "",
        startTime: s.start_time,
        endTime: s.end_time
      }));

    const data = uniqueSlots.filter((s) => s.effectiveStatus === "available");

    const items = data.map((slot) => ({
      id: slot.id,
      fieldId: slot.field_id,
      fieldName: slot.fields?.name || "",
      pitchFormat: slot.fields?.pitch_format || "5v5",
      startTime: slot.start_time,
      endTime: slot.end_time,
      status: "available",
      pricePerSlot: Number(slot.price_vnd ?? slot.fields?.price_per_slot ?? 0)
    }));

    return res.status(200).json({ date, items, busyRanges });
  })
);
