import { Router } from "express";
import { supabaseAdminClient } from "../lib/supabase.js";
import { asyncHandler, sendError } from "../utils/http.js";

export const slotsRouter = Router();

slotsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { date, venueId } = req.query;
    if (!date || !venueId) {
      return sendError(res, 400, "VALIDATION_ERROR", "date and venueId are required");
    }

    const start = new Date(`${date}T00:00:00+07:00`).toISOString();
    const end = new Date(`${date}T23:59:59+07:00`).toISOString();

    const { data, error } = await supabaseAdminClient
      .from("available_slots")
      .select(
        "id, field_id, start_time, end_time, status, fields:field_id!inner(name, venue_id, price_per_slot)"
      )
      .gte("start_time", start)
      .lte("start_time", end)
      .eq("fields.venue_id", venueId)
      .order("start_time", { ascending: true });

    if (error) {
      return sendError(res, 500, "DB_ERROR", "Failed to fetch slots");
    }

    const items = (data || []).map((slot) => ({
      id: slot.id,
      fieldId: slot.field_id,
      fieldName: slot.fields?.name || "",
      startTime: slot.start_time,
      endTime: slot.end_time,
      status: slot.status,
      pricePerSlot: slot.fields?.price_per_slot || 0
    }));

    return res.status(200).json({ date, items });
  })
);
