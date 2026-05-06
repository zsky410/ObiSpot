import { Router } from "express";
import { z } from "zod";
import { parseRefundRequestNote } from "../lib/refundRequestMetadata.js";
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
import { buildSlotKey, ensureVenueDailySlots, insertTimeSlotsSafely, withTimeSlotWriteLock } from "../lib/slotAutoSeed.js";
import { selectAllPages } from "../lib/supabasePaginate.js";

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
const adminDashboardQuerySchema = z.object({
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
  venueId: uuidLikeSchema.optional(),
  status: z.enum(["pending", "confirmed", "cancelled"]).optional()
});
const bookingParamsSchema = z.object({
  bookingId: uuidLikeSchema
});
const updateBookingBodySchema = z.object({
  status: z.enum(["confirmed", "cancelled"])
});
const decideCancelRequestBodySchema = z.object({
  decision: z.enum(["approved", "rejected"])
});
const refundRequestParamsSchema = z.object({
  refundRequestId: uuidLikeSchema
});
const markRefundedBodySchema = z.object({
  action: z.literal("mark_refunded")
});
const slotParamsSchema = z.object({
  slotId: uuidLikeSchema
});
const updateSlotBodySchema = z.object({
  status: z.enum(["available", "blocked"])
});
const bulkUpdateSlotStatusBodySchema = z.object({
  slotIds: z.array(uuidLikeSchema).min(1).max(300),
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

function firstJoinedRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function aggregateCancelRequest(rows) {
  const requestedRows = rows.filter((row) => row.cancel_request_status);
  if (requestedRows.length === 0) {
    return {
      status: null,
      requestedAt: null,
      note: null
    };
  }

  const status = requestedRows.some((row) => row.cancel_request_status === "pending")
    ? "pending"
    : requestedRows.some((row) => row.cancel_request_status === "approved")
      ? "approved"
      : "rejected";

  let requestedAt = null;
  for (const row of requestedRows) {
    if (
      row.cancel_requested_at &&
      (!requestedAt || new Date(row.cancel_requested_at).getTime() > new Date(requestedAt).getTime())
    ) {
      requestedAt = row.cancel_requested_at;
    }
  }

  return {
    status,
    requestedAt,
    note: requestedRows.find((row) => row.cancel_request_note)?.cancel_request_note || null
  };
}

function mapRefundRequestRow(row) {
  if (!row) {
    return null;
  }

  const parsedMetadata = parseRefundRequestNote(row.note);

  const hasBankAccount = Boolean(
    row.beneficiary_bank_name || row.beneficiary_account_number || row.beneficiary_account_name
  );

  return {
    id: row.id,
    totalAmountVnd: Number(row.total_amount_vnd ?? 0),
    feePercent: Number(row.fee_percent ?? 0),
    refundAmountVnd: Number(row.refund_amount_vnd ?? 0),
    status: row.status,
    requestedAt: row.requested_at || null,
    decidedAt: row.decided_at || null,
    note: parsedMetadata.note,
    bankAccount: hasBankAccount
      ? {
          bankName: row.beneficiary_bank_name || "",
          accountNumber: row.beneficiary_account_number || "",
          accountHolderName: row.beneficiary_account_name || ""
        }
      : parsedMetadata.bankAccount
  };
}

function isMissingRefundBankColumnsError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /beneficiary_(bank_name|account_number|account_name)/i.test(message);
}

async function fetchRefundRequestRowsByOrderIds(orderIds) {
  if (!orderIds.length) {
    return { data: [], error: null };
  }

  const baseSelect = "id, order_id, total_amount_vnd, fee_percent, refund_amount_vnd, status, requested_at, decided_at, note";
  const extendedSelect = `${baseSelect}, beneficiary_bank_name, beneficiary_account_number, beneficiary_account_name`;

  let result = await supabaseAdminClient.from("refund_requests").select(extendedSelect).in("order_id", orderIds);
  if (result.error && isMissingRefundBankColumnsError(result.error)) {
    result = await supabaseAdminClient.from("refund_requests").select(baseSelect).in("order_id", orderIds);
  }

  return result;
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
    const query = supabaseAdminClient
      .from("bookings")
      .select(
        "id, order_id, status, payment_status, created_at, user_id, slot_id, cancel_requested_at, cancel_request_note, cancel_request_status, profiles:user_id(full_name), time_slots:slot_id(start_time, end_time, price_vnd, fields:field_id(name, venue_id, venues:venue_id(name, address)))"
      );

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch admin bookings");
    }

    const grouped = new Map();
    for (const item of data || []) {
      const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
      const timeSlot = Array.isArray(item.time_slots) ? item.time_slots[0] : item.time_slots;
      const field = Array.isArray(timeSlot?.fields) ? timeSlot.fields[0] : timeSlot?.fields;
      const venue = Array.isArray(field?.venues) ? field.venues[0] : field?.venues;
      const key = item.order_id || item.id;
      const existing = grouped.get(key);
      const slotPrice = Number(timeSlot?.price_vnd ?? 0);
      if (!existing) {
        grouped.set(key, {
          id: key,
          status: item.status,
          createdAt: item.created_at,
          userId: item.user_id,
          customerName: profile?.full_name || "",
          slotId: item.slot_id,
          cancelRequest: {
            status: item.cancel_request_status || null,
            requestedAt: item.cancel_requested_at || null,
            note: item.cancel_request_note || null
          },
          paymentStatus: item.payment_status || "awaiting",
          refundRequest: null,
          slotStartTime: timeSlot?.start_time || null,
          slotEndTime: timeSlot?.end_time || null,
          fieldName: field?.name || "",
          venueId: field?.venue_id || null,
          venueName: venue?.name || "",
          venueAddress: venue?.address || "",
          totalPrice: slotPrice,
          slotCount: 1
        });
        continue;
      }

      const startMs = timeSlot?.start_time ? new Date(timeSlot.start_time).getTime() : null;
      const endMs = timeSlot?.end_time ? new Date(timeSlot.end_time).getTime() : null;
      const curStartMs = existing.slotStartTime ? new Date(existing.slotStartTime).getTime() : Number.POSITIVE_INFINITY;
      const curEndMs = existing.slotEndTime ? new Date(existing.slotEndTime).getTime() : Number.NEGATIVE_INFINITY;
      if (startMs !== null && startMs < curStartMs) {
        existing.slotStartTime = timeSlot.start_time;
      }
      if (endMs !== null && endMs > curEndMs) {
        existing.slotEndTime = timeSlot.end_time;
      }
      existing.slotCount += 1;
      existing.totalPrice += slotPrice;
      if (!existing.venueName && venue?.name) {
        existing.venueName = venue.name;
      }
      if (!existing.venueAddress && venue?.address) {
        existing.venueAddress = venue.address;
      }
      if (item.cancel_request_status === "pending") {
        existing.cancelRequest.status = "pending";
      } else if (item.cancel_request_status === "approved" && existing.cancelRequest.status !== "pending") {
        existing.cancelRequest.status = "approved";
      } else if (item.cancel_request_status === "rejected" && !existing.cancelRequest.status) {
        existing.cancelRequest.status = "rejected";
      }
      if (item.cancel_requested_at) {
        const currentRequestedAt = existing.cancelRequest.requestedAt
          ? new Date(existing.cancelRequest.requestedAt).getTime()
          : Number.NEGATIVE_INFINITY;
        const nextRequestedAt = new Date(item.cancel_requested_at).getTime();
        if (nextRequestedAt > currentRequestedAt) {
          existing.cancelRequest.requestedAt = item.cancel_requested_at;
        }
      }
      if (!existing.cancelRequest.note && item.cancel_request_note) {
        existing.cancelRequest.note = item.cancel_request_note;
      }
      if (item.status === "pending" || existing.status === "pending") {
        existing.status = "pending";
      } else if (item.status === "confirmed" || existing.status === "confirmed") {
        existing.status = "confirmed";
      } else {
        existing.status = "cancelled";
      }
      if (item.payment_status === "paid" || existing.paymentStatus === "paid") {
        existing.paymentStatus = "paid";
      } else if (item.payment_status === "expired" || existing.paymentStatus === "expired") {
        existing.paymentStatus = "expired";
      } else if (item.payment_status === "refunded" || existing.paymentStatus === "refunded") {
        existing.paymentStatus = "refunded";
      } else {
        existing.paymentStatus = "awaiting";
      }
    }

    let items = Array.from(grouped.values()).sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
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
    if (status) {
      items = items.filter((item) => item.status === status);
    }

    const orderIds = items.map((item) => item.id);
    if (orderIds.length > 0) {
      const { data: refundRows, error: refundError } = await fetchRefundRequestRowsByOrderIds(orderIds);
      if (refundError) {
        return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch admin refund requests");
      }

      const refundByOrderId = new Map((refundRows || []).map((row) => [row.order_id, row]));
      items = items.map((item) => ({
        ...item,
        refundRequest: mapRefundRequestRow(refundByOrderId.get(item.id))
      }));
    }

    return res.status(200).json({ items });
  })
);

adminRouter.patch(
  "/bookings/:bookingId/cancel-request",
  validateParams(bookingParamsSchema),
  validateBody(decideCancelRequestBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid cancel request decision",
        { fields: req.validationError }
      );
    }

    const { bookingId } = req.validatedParams;
    const { decision } = req.validatedBody;
    const { data: matchRows, error: currentError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id")
      .or(`id.eq.${bookingId},order_id.eq.${bookingId}`)
      .limit(1);

    const current = matchRows?.[0];
    if (currentError || !current) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Booking not found");
    }

    const orderId = current.order_id ?? current.id;
    const orderFilter = current.order_id != null ? { column: "order_id", value: orderId } : { column: "id", value: current.id };

    const { data: rowsInOrder, error: orderReadError } = await supabaseAdminClient
      .from("bookings")
      .select("id, status, cancel_requested_at, cancel_request_note, cancel_request_status")
      .eq(orderFilter.column, orderFilter.value);

    if (orderReadError || !rowsInOrder || rowsInOrder.length === 0) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to resolve booking cancel request");
    }

    const currentCancelRequest = aggregateCancelRequest(rowsInOrder);
    if (currentCancelRequest.status !== "pending") {
      return sendError(
        res,
        409,
        ERROR_CODES.invalidStatusTransition,
        "Booking does not have a pending cancel request"
      );
    }

    const updatePayload =
      decision === "approved"
        ? { status: "cancelled", cancel_request_status: "approved" }
        : { cancel_request_status: "rejected" };

    const { data: updatedRows, error: updateError } = await supabaseAdminClient
      .from("bookings")
      .update(updatePayload)
      .eq(orderFilter.column, orderFilter.value)
      .select("id, status, cancel_requested_at, cancel_request_note, cancel_request_status, slot_id, user_id, created_at, order_id");

    if (updateError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to process booking cancel request");
    }

    const { error: refundUpdateError } = await supabaseAdminClient
      .from("refund_requests")
      .update({
        status: decision === "approved" ? "approved" : "rejected",
        decided_at: new Date().toISOString()
      })
      .eq("order_id", orderId);

    if (refundUpdateError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to update refund request");
    }

    const first = (updatedRows || [])[0];
    return res.status(200).json({
      id: orderId,
      updatedCount: (updatedRows || []).length,
      status: first?.status || (decision === "approved" ? "cancelled" : null),
      cancelRequest: aggregateCancelRequest(updatedRows || [])
    });
  })
);

adminRouter.patch(
  "/refund-requests/:refundRequestId",
  validateParams(refundRequestParamsSchema),
  validateBody(markRefundedBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid refund request action", {
        fields: req.validationError
      });
    }

    const { refundRequestId } = req.validatedParams;
    const { data: row, error: readError } = await supabaseAdminClient
      .from("refund_requests")
      .select("id, order_id, status")
      .eq("id", refundRequestId)
      .maybeSingle();

    if (readError || !row) {
      return sendError(res, 404, ERROR_CODES.notFound, "Refund request not found");
    }

    const { error: updateError } = await supabaseAdminClient
      .from("refund_requests")
      .update({ status: "refunded", decided_at: new Date().toISOString() })
      .eq("id", refundRequestId);

    if (updateError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to mark refund as completed");
    }

    await supabaseAdminClient
      .from("bookings")
      .update({ payment_status: "refunded" })
      .eq("order_id", row.order_id);
    await supabaseAdminClient.from("payments").update({ status: "refunded" }).eq("order_id", row.order_id);

    return res.status(200).json({
      id: refundRequestId,
      orderId: row.order_id,
      status: "refunded"
    });
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

    // bookingId có thể là id một dòng hoặc order_id chung (nhiều slot). Không dùng maybeSingle()
    // với .or(...): nếu order_id khớp nhiều dòng, PostgREST sẽ lỗi "multiple rows".
    const { data: matchRows, error: currentError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id, status")
      .or(`id.eq.${bookingId},order_id.eq.${bookingId}`)
      .limit(1);

    const current = matchRows?.[0];
    if (currentError || !current) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Booking not found");
    }

    const orderId = current.order_id ?? current.id;
    const orderFilter = current.order_id != null ? { column: "order_id", value: orderId } : { column: "id", value: current.id };

    const { data: rowsInOrder, error: orderReadError } = await supabaseAdminClient
      .from("bookings")
      .select("id, status, payment_status")
      .eq(orderFilter.column, orderFilter.value);

    if (orderReadError || !rowsInOrder || rowsInOrder.length === 0) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to resolve booking order");
    }

    if (rowsInOrder.some((row) => row.status !== "pending")) {
      return sendError(
        res,
        409,
        ERROR_CODES.invalidStatusTransition,
        "Only pending booking/order can be updated"
      );
    }

    if (status === "confirmed" && rowsInOrder.some((row) => row.payment_status !== "paid")) {
      return sendError(
        res,
        409,
        ERROR_CODES.paymentNotPaid,
        "Chỉ có thể xác nhận đơn đã thanh toán"
      );
    }

    const updatePayload =
      status === "cancelled" && rowsInOrder.every((row) => row.payment_status === "awaiting")
        ? { status, payment_status: "expired" }
        : { status };

    const { data, error } = await supabaseAdminClient
      .from("bookings")
      .update(updatePayload)
      .eq(orderFilter.column, orderFilter.value)
      .select("id, status, slot_id, user_id, created_at, order_id");

    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to update booking");
    }

    if (status === "cancelled" && rowsInOrder.every((row) => row.payment_status === "awaiting")) {
      await supabaseAdminClient.from("payments").update({ status: "expired" }).eq("order_id", orderId);
    }

    const first = (data || [])[0];
    return res.status(200).json({
      id: orderId,
      orderId,
      updatedCount: (data || []).length,
      status: first?.status || status,
      slotId: first?.slot_id || null,
      userId: first?.user_id || null,
      createdAt: first?.created_at || null
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
    await ensureVenueDailySlots(supabaseAdminClient, {
      venueId,
      date,
      slotMinutes: 30,
      dailyStart: "05:00",
      dailyEnd: "23:00"
    });
    const rangeStart = new Date(`${date}T05:00:00+07:00`).toISOString();
    const rangeEndExclusive = new Date(`${date}T23:00:00+07:00`).toISOString();

    const { data, error } = await selectAllPages(
      () =>
        supabaseAdminClient
          .from("time_slots")
          .select("id, field_id, start_time, end_time, status, fields:field_id!inner(name, venue_id)")
          .eq("fields.venue_id", venueId)
          .gte("start_time", rangeStart)
          .lt("start_time", rangeEndExclusive)
          .order("field_id", { ascending: true })
          .order("start_time", { ascending: true })
          .order("id", { ascending: true }),
      { pageSize: 2000 }
    );

    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch admin slots");
    }

    const slots = data || [];
    const slotGroups = new Map();
    const fieldIds = new Set();

    for (const slot of slots) {
      fieldIds.add(slot.field_id);
      const key = buildSlotKey(slot.field_id, slot.start_time, slot.end_time);
      const field = firstJoinedRow(slot.fields);
      const current = slotGroups.get(key) || {
        key,
        fieldId: slot.field_id,
        fieldName: field?.name || "",
        startTime: slot.start_time,
        endTime: slot.end_time,
        slotIds: new Set(),
        availableSlotIds: new Set(),
        blockedSlotIds: new Set()
      };
      current.slotIds.add(slot.id);
      if (slot.status === "blocked") {
        current.blockedSlotIds.add(slot.id);
      }
      else {
        current.availableSlotIds.add(slot.id);
      }
      slotGroups.set(key, current);
    }

    const bookedBySlotKey = new Map();
    if (fieldIds.size > 0) {
      const { data: bookingRows, error: bookingError } = await selectAllPages(
        () =>
          supabaseAdminClient
            .from("bookings")
            .select("id, order_id, slot_id, status, time_slots:slot_id!inner(field_id, start_time, end_time)")
            .in("status", ["pending", "confirmed"])
            .in("time_slots.field_id", Array.from(fieldIds))
            .gte("time_slots.start_time", rangeStart)
            .lt("time_slots.start_time", rangeEndExclusive)
            .order("slot_id", { ascending: true })
            .order("id", { ascending: true }),
        { pageSize: 1000 }
      );

      if (bookingError) {
        return sendError(res, 500, ERROR_CODES.dbError, "Failed to resolve slot bookings");
      }

      for (const row of bookingRows || []) {
        const slot = firstJoinedRow(row.time_slots);
        if (!slot) continue;

        const key = buildSlotKey(slot.field_id, slot.start_time, slot.end_time);
        const current = bookedBySlotKey.get(key) || {
          bookedSlotIds: new Set(),
          primarySlotId: row.slot_id,
          status: row.status,
          bookingGroupId: row.order_id || row.id
        };

        current.bookedSlotIds.add(row.slot_id);
        if (!current.primarySlotId) {
          current.primarySlotId = row.slot_id;
        }
        if (row.status === "pending") {
          current.status = "pending";
        }
        if (!current.bookingGroupId) {
          current.bookingGroupId = row.order_id || row.id;
        }

        bookedBySlotKey.set(key, current);
      }
    }

    const items = Array.from(slotGroups.values()).map((group) => {
      const bookedInfo = bookedBySlotKey.get(group.key);
      const bookedSlotIds = bookedInfo ? Array.from(bookedInfo.bookedSlotIds) : [];
      const blockedSlotIds = Array.from(group.blockedSlotIds);
      const availableSlotIds = Array.from(group.availableSlotIds);
      const representativeId =
        bookedInfo?.primarySlotId ||
        blockedSlotIds[0] ||
        availableSlotIds[0] ||
        Array.from(group.slotIds)[0];
      const effectiveStatus = bookedSlotIds.length
        ? "booked"
        : blockedSlotIds.length
          ? "blocked"
          : "available";

      return {
        id: representativeId,
        fieldId: group.fieldId,
        fieldName: group.fieldName,
        startTime: group.startTime,
        endTime: group.endTime,
        status: effectiveStatus,
        bookingStatus: bookedInfo?.status || null,
        bookingGroupId: bookedInfo?.bookingGroupId || null,
        availableSlotIds,
        blockedSlotIds,
        bookedSlotIds
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

    return withTimeSlotWriteLock(
      `field:${fieldId}|from:${fromDate}|to:${toDate}|slotMinutes:${slotMinutes}|window:${dailyStart}-${dailyEnd}`,
      async () => {
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
          (existing || []).map((slot) => buildSlotKey(fieldId, slot.start_time, slot.end_time))
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
            const key = buildSlotKey(fieldId, startTs, endTs);

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

        let createdCount = 0;
        if (rowsToInsert.length > 0) {
          const { error: insertError, insertedCount } = await insertTimeSlotsSafely(supabaseAdminClient, rowsToInsert);
          if (insertError) {
            return sendError(res, 500, ERROR_CODES.dbError, "Failed to create slots in bulk");
          }
          createdCount = insertedCount;
          skippedCount += Math.max(rowsToInsert.length - insertedCount, 0);
        }

        return res.status(200).json({
          fieldId,
          fromDate,
          toDate,
          createdCount,
          skippedCount
        });
      }
    );
  })
);

adminRouter.get(
  "/dashboard",
  validateQuery(adminDashboardQuerySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid dashboard query params",
        { fields: req.validationError }
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    const defaultFromDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { fromDate = defaultFromDate, toDate = today, venueId, status } = req.validatedQuery;

    const rangeStart = localTimestamp(fromDate, "00:00");
    const rangeEndExclusive = new Date(new Date(localTimestamp(toDate, "00:00")).getTime() + 24 * 60 * 60 * 1000).toISOString();

    let bookingQuery = supabaseAdminClient
      .from("bookings")
      .select(
        "id, order_id, status, created_at, slot_id, time_slots:slot_id(start_time, end_time, price_vnd, fields:field_id(name, venue_id, venues:venue_id(name)))"
      )
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEndExclusive);
    if (status) {
      bookingQuery = bookingQuery.eq("status", status);
    }

    const { data: bookingRows, error: bookingError } = await bookingQuery.order("created_at", { ascending: true });
    if (bookingError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch dashboard bookings");
    }

    const orders = new Map();
    for (const row of bookingRows || []) {
      const key = row.order_id || row.id;
      const timeSlot = Array.isArray(row.time_slots) ? row.time_slots[0] : row.time_slots;
      const field = Array.isArray(timeSlot?.fields) ? timeSlot.fields[0] : timeSlot?.fields;
      const venue = Array.isArray(field?.venues) ? field.venues[0] : field?.venues;
      if (venueId && field?.venue_id !== venueId) {
        continue;
      }
      const slotPrice = Number(timeSlot?.price_vnd ?? 0);
      const existing = orders.get(key);
      if (!existing) {
        orders.set(key, {
          orderId: key,
          status: row.status,
          createdAt: row.created_at,
          totalPrice: slotPrice,
          venueId: field?.venue_id || null,
          venueName: venue?.name || ""
        });
        continue;
      }
      existing.totalPrice += slotPrice;
      if (row.status === "pending" || existing.status === "pending") existing.status = "pending";
      else if (row.status === "confirmed" || existing.status === "confirmed") existing.status = "confirmed";
      else existing.status = "cancelled";
    }

    const orderItems = Array.from(orders.values());
    const statusCount = {
      pending: orderItems.filter((i) => i.status === "pending").length,
      confirmed: orderItems.filter((i) => i.status === "confirmed").length,
      cancelled: orderItems.filter((i) => i.status === "cancelled").length
    };
    const ordersTotal = orderItems.length;
    const revenueTotal = orderItems
      .filter((i) => i.status === "confirmed")
      .reduce((acc, i) => acc + Number(i.totalPrice || 0), 0);

    const days = [];
    let cursor = new Date(localTimestamp(fromDate, "00:00"));
    const endCursor = new Date(localTimestamp(toDate, "00:00"));
    while (cursor.getTime() <= endCursor.getTime()) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    const orderByDayMap = new Map(days.map((d) => [d, { date: d, orders: 0, revenue: 0 }]));
    for (const item of orderItems) {
      const dayKey = item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : null;
      if (!dayKey || !orderByDayMap.has(dayKey)) continue;
      const slot = orderByDayMap.get(dayKey);
      slot.orders += 1;
      if (item.status === "confirmed") {
        slot.revenue += Number(item.totalPrice || 0);
      }
    }
    const ordersByDay = Array.from(orderByDayMap.values());

    let slotQuery = supabaseAdminClient
      .from("time_slots")
      .select("id, status, fields:field_id!inner(venue_id)")
      .gte("start_time", rangeStart)
      .lt("start_time", rangeEndExclusive);
    if (venueId) {
      slotQuery = slotQuery.eq("fields.venue_id", venueId);
    }
    const { data: slotRows, error: slotError } = await slotQuery;
    if (slotError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch dashboard slots");
    }

    const totalSlots = (slotRows || []).length;
    const activeRowsCount = (bookingRows || []).filter((r) => r.status === "pending" || r.status === "confirmed").length;
    const slotUtilization = totalSlots === 0 ? 0 : Number((activeRowsCount / totalSlots).toFixed(2));

    return res.status(200).json({
      fromDate,
      toDate,
      filters: { venueId: venueId || null, status: status || "all" },
      ordersTotal,
      revenueTotal,
      totalSlots,
      slotUtilization,
      statusCount,
      ordersByDay
    });
  })
);

adminRouter.patch(
  "/slots/status/bulk",
  validateBody(bulkUpdateSlotStatusBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid bulk update slot status request",
        { fields: req.validationError }
      );
    }
    const { slotIds, status } = req.validatedBody;
    const { data, error } = await supabaseAdminClient
      .from("time_slots")
      .update({ status })
      .in("id", slotIds)
      .select("id");

    if (error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to bulk update slot status");
    }

    return res.status(200).json({
      updatedCount: (data || []).length,
      slotIds: (data || []).map((row) => row.id),
      status
    });
  })
);

adminRouter.get(
  "/slots/:slotId/booking",
  validateParams(slotParamsSchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid slot booking detail request",
        { fields: req.validationError }
      );
    }

    const { slotId } = req.validatedParams;
    const { data: matchedRows, error: matchedError } = await supabaseAdminClient
      .from("bookings")
      .select(
        "id, order_id, status, note, created_at, user_id, profiles:user_id(full_name, phone), time_slots:slot_id(start_time, end_time, price_vnd, fields:field_id(name, venues:venue_id(name, address)))"
      )
      .eq("slot_id", slotId)
      .in("status", ["pending", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (matchedError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch slot booking detail");
    }

    const matched = matchedRows?.[0];
    if (!matched) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Slot này chưa có đơn đặt hợp lệ");
    }

    const orderId = matched.order_id || matched.id;
    const orderFilter = matched.order_id ? { column: "order_id", value: matched.order_id } : { column: "id", value: matched.id };
    const { data: orderRows, error: orderError } = await supabaseAdminClient
      .from("bookings")
      .select(
        "id, order_id, status, note, created_at, user_id, profiles:user_id(full_name, phone), time_slots:slot_id(start_time, end_time, price_vnd, fields:field_id(name, venues:venue_id(name, address)))"
      )
      .eq(orderFilter.column, orderFilter.value)
      .in("status", ["pending", "confirmed"])
      .order("created_at", { ascending: true });

    if (orderError || !orderRows || orderRows.length === 0) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to aggregate booking detail");
    }

    let bookingStartTime = null;
    let bookingEndTime = null;
    let totalPriceVnd = 0;

    for (const row of orderRows) {
      const slot = Array.isArray(row.time_slots) ? row.time_slots[0] : row.time_slots;
      const slotStart = slot?.start_time || null;
      const slotEnd = slot?.end_time || null;

      if (slotStart && (!bookingStartTime || new Date(slotStart).getTime() < new Date(bookingStartTime).getTime())) {
        bookingStartTime = slotStart;
      }
      if (slotEnd && (!bookingEndTime || new Date(slotEnd).getTime() > new Date(bookingEndTime).getTime())) {
        bookingEndTime = slotEnd;
      }
      totalPriceVnd += Number(slot?.price_vnd ?? 0);
    }

    const primaryRow = orderRows[0];
    const profile = Array.isArray(primaryRow.profiles) ? primaryRow.profiles[0] : primaryRow.profiles;
    const primarySlot = Array.isArray(primaryRow.time_slots) ? primaryRow.time_slots[0] : primaryRow.time_slots;
    const field = Array.isArray(primarySlot?.fields) ? primarySlot.fields[0] : primarySlot?.fields;
    const venue = Array.isArray(field?.venues) ? field.venues[0] : field?.venues;
    const aggregatedStatus = orderRows.some((row) => row.status === "pending") ? "pending" : "confirmed";
    const note = orderRows.find((row) => row.note)?.note || "";

    return res.status(200).json({
      booking: {
        id: orderId,
        bookingRowId: matched.id,
        status: aggregatedStatus,
        createdAt: primaryRow.created_at,
        note,
        customer: {
          id: primaryRow.user_id,
          fullName: profile?.full_name || "",
          phone: profile?.phone || ""
        },
        slot: {
          id: orderId,
          startTime: bookingStartTime,
          endTime: bookingEndTime,
          totalPriceVnd,
          slotCount: orderRows.length,
          fieldName: field?.name || "",
          venueName: venue?.name || "",
          venueAddress: venue?.address || ""
        }
      }
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
