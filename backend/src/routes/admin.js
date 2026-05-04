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
import { computeSlotPriceVnd } from "../lib/slotPricing.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

const adminBookingsQuerySchema = z.object({
  date: z.iso.date().optional(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional()
});
const adminSlotsQuerySchema = z.object({
  date: z.iso.date(),
  venueId: uuidLikeSchema
});
const adminFieldsQuerySchema = z.object({
  venueId: uuidLikeSchema
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
const bulkSlotsBodySchema = z.object({
  fieldId: uuidLikeSchema,
  fromDate: z.iso.date(),
  toDate: z.iso.date(),
  slotMinutes: z.int().min(30).max(180),
  dailyStart: z.string().regex(/^\d{2}:\d{2}$/),
  dailyEnd: z.string().regex(/^\d{2}:\d{2}$/)
});

function parseMinutesFromHm(hm) {
  const [hours, minutes] = hm.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatHmFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function localTimestamp(date, hm) {
  return `${date}T${hm}:00+07:00`;
}

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
      .select(
        "id, status, created_at, user_id, slot_id, profiles:user_id(full_name), time_slots:slot_id(start_time, end_time, fields:field_id(name, venue_id))"
      );

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch admin bookings");
    }

    let items = (data || []).map((item) => {
      const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
      const timeSlot = Array.isArray(item.time_slots) ? item.time_slots[0] : item.time_slots;
      const field = Array.isArray(timeSlot?.fields) ? timeSlot.fields[0] : timeSlot?.fields;
      return {
        id: item.id,
        status: item.status,
        createdAt: item.created_at,
        userId: item.user_id,
        customerName: profile?.full_name || "",
        slotId: item.slot_id,
        slotStartTime: timeSlot?.start_time || null,
        slotEndTime: timeSlot?.end_time || null,
        fieldName: field?.name || "",
        venueId: field?.venue_id || null
      };
    });

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

adminRouter.get(
  "/fields",
  validateQuery(adminFieldsQuerySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid admin fields query params",
        { fields: req.validationError }
      );
    }
    const { venueId } = req.validatedQuery;
    const { data, error } = await supabaseAdminClient
      .from("fields")
      .select("id, name, venue_id")
      .eq("venue_id", venueId)
      .order("name", { ascending: true });
    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch fields");
    }
    return res.status(200).json({
      items: (data || []).map((f) => ({ id: f.id, name: f.name, venueId: f.venue_id }))
    });
  })
);

adminRouter.get(
  "/slots",
  validateQuery(adminSlotsQuerySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid admin slots query params",
        { fields: req.validationError }
      );
    }
    const { date, venueId } = req.validatedQuery;
    const start = new Date(`${date}T00:00:00+07:00`).toISOString();
    const end = new Date(`${date}T23:59:59+07:00`).toISOString();

    const { data, error } = await supabaseAdminClient
      .from("time_slots")
      .select("id, field_id, start_time, end_time, status, fields:field_id(name, venue_id)")
      .eq("fields.venue_id", venueId)
      .gte("start_time", start)
      .lte("start_time", end)
      .order("start_time", { ascending: true });

    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch admin slots");
    }

    const items = (data || []).map((slot) => {
      const field = Array.isArray(slot.fields) ? slot.fields[0] : slot.fields;
      return {
        id: slot.id,
        fieldId: slot.field_id,
        fieldName: field?.name || "",
        startTime: slot.start_time,
        endTime: slot.end_time,
        status: slot.status
      };
    });

    return res.status(200).json({ date, venueId, items });
  })
);

adminRouter.post(
  "/slots/bulk",
  validateBody(bulkSlotsBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid bulk slots request", {
        fields: req.validationError
      });
    }

    const { fieldId, fromDate, toDate, slotMinutes, dailyStart, dailyEnd } = req.validatedBody;
    const startMinutes = parseMinutesFromHm(dailyStart);
    const endMinutes = parseMinutesFromHm(dailyEnd);

    if (startMinutes >= endMinutes) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "dailyStart must be earlier than dailyEnd"
      );
    }
    if (slotMinutes > endMinutes - startMinutes) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "slotMinutes is larger than the daily window"
      );
    }

    const rangeStart = localTimestamp(fromDate, "00:00");
    const rangeEnd = localTimestamp(toDate, "23:59");
    const { data: existing, error: existingError } = await supabaseAdminClient
      .from("time_slots")
      .select("id, start_time, end_time")
      .eq("field_id", fieldId)
      .gte("start_time", rangeStart)
      .lte("start_time", rangeEnd);

    if (existingError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to read existing slots");
    }

    const existingKeys = new Set(
      (existing || []).map((slot) => `${slot.start_time}|${slot.end_time}`)
    );
    const rowsToInsert = [];
    let cursorDate = new Date(`${fromDate}T00:00:00Z`);
    const endDate = new Date(`${toDate}T00:00:00Z`);
    let skippedCount = 0;

    while (cursorDate <= endDate) {
      const dateStr = cursorDate.toISOString().slice(0, 10);
      for (
        let start = startMinutes;
        start + slotMinutes <= endMinutes;
        start += slotMinutes
      ) {
        const end = start + slotMinutes;
        const startHm = formatHmFromMinutes(start);
        const endHm = formatHmFromMinutes(end);
        const startTs = localTimestamp(dateStr, startHm);
        const endTs = localTimestamp(dateStr, endHm);
        const key = `${new Date(startTs).toISOString()}|${new Date(endTs).toISOString()}`;

        if (existingKeys.has(key)) {
          skippedCount += 1;
          continue;
        }
        existingKeys.add(key);
        rowsToInsert.push({
          field_id: fieldId,
          start_time: startTs,
          end_time: endTs,
          status: "available",
          price_vnd: computeSlotPriceVnd(startTs, endTs)
        });
      }
      cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabaseAdminClient.from("time_slots").insert(rowsToInsert);
      if (insertError) {
        return sendError(res, 500, ERROR_CODES.dbError, "Failed to create slots in bulk");
      }
    }

    return res.status(200).json({
      fieldId,
      fromDate,
      toDate,
      createdCount: rowsToInsert.length,
      skippedCount
    });
  })
);

adminRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const start = `${todayDate}T00:00:00+07:00`;
    const end = `${todayDate}T23:59:59+07:00`;

    const { data: slotsData, error: slotsError } = await supabaseAdminClient
      .from("time_slots")
      .select("id")
      .gte("start_time", start)
      .lte("start_time", end);

    if (slotsError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch dashboard slots");
    }

    const { data: activeBookings, error: bookingError } = await supabaseAdminClient
      .from("bookings")
      .select("id, slot_id, time_slots:slot_id(start_time)")
      .in("status", ["pending", "confirmed"]);

    if (bookingError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch dashboard bookings");
    }

    const activeToday = (activeBookings || []).filter((item) => {
      const slotStartTime = item.time_slots?.start_time;
      if (!slotStartTime) {
        return false;
      }
      const slotDate = new Date(slotStartTime).toISOString().slice(0, 10);
      return slotDate === todayDate;
    });

    const totalSlotsToday = (slotsData || []).length;
    const bookingsToday = activeToday.length;
    const slotUtilization = totalSlotsToday === 0 ? 0 : Number((bookingsToday / totalSlotsToday).toFixed(2));

    return res.status(200).json({
      date: todayDate,
      bookingsToday,
      totalSlotsToday,
      slotUtilization
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
