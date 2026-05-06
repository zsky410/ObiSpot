import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { encodeRefundRequestNote, parseRefundRequestNote } from "../lib/refundRequestMetadata.js";
import { supabaseAdminClient } from "../lib/supabase.js";
import { env } from "../config/env.js";
import {
  buildSepayCheckoutForm,
  buildSepayCheckoutPayload,
  buildInternalCheckoutUrl,
  buildPaymentCallbackUrls,
  buildVietQrPreviewUrl
} from "../lib/sepayGateway.js";
import { requireAuth } from "../middleware/auth.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, uuidLikeSchema, validateBody, validateParams } from "../utils/validate.js";

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
const bookingParamsSchema = z.object({
  bookingId: uuidLikeSchema
});
const refundBankAccountSchema = z.object({
  bankName: z.string().trim().min(2).max(120),
  accountNumber: z
    .string()
    .trim()
    .min(6)
    .max(34)
    .regex(/^[0-9 ]+$/)
    .refine((value) => {
      const normalized = value.replace(/\s+/g, "");
      return normalized.length >= 6 && normalized.length <= 30;
    }, "Account number must be 6-30 digits"),
  accountHolderName: z.string().trim().min(2).max(120)
});
const cancelRequestBodySchema = z.object({
  note: z.string().trim().max(300).optional().nullable(),
  refundBankAccount: refundBankAccountSchema
});
const bookingOrderParamsSchema = z.object({
  bookingId: uuidLikeSchema
});

function slotInstantMs(iso) {
  return new Date(iso).getTime();
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
    if (row.cancel_requested_at && (!requestedAt || new Date(row.cancel_requested_at).getTime() > new Date(requestedAt).getTime())) {
      requestedAt = row.cancel_requested_at;
    }
  }

  return {
    status,
    requestedAt,
    note: requestedRows.find((row) => row.cancel_request_note)?.cancel_request_note || null
  };
}

function normalizeRefundBankAccount(bankAccount) {
  return {
    bankName: bankAccount.bankName.trim(),
    accountNumber: bankAccount.accountNumber.replace(/\s+/g, ""),
    accountHolderName: bankAccount.accountHolderName.trim()
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

  const baseSelect = "order_id, total_amount_vnd, fee_percent, refund_amount_vnd, status, requested_at, decided_at, note";
  const extendedSelect = `${baseSelect}, beneficiary_bank_name, beneficiary_account_number, beneficiary_account_name`;

  let result = await supabaseAdminClient.from("refund_requests").select(extendedSelect).in("order_id", orderIds);
  if (result.error && isMissingRefundBankColumnsError(result.error)) {
    result = await supabaseAdminClient.from("refund_requests").select(baseSelect).in("order_id", orderIds);
  }

  return result;
}

async function upsertRefundRequestWithFallback(payload, refundBankAccount) {
  const extendedPayload = {
    ...payload,
    beneficiary_bank_name: refundBankAccount.bankName,
    beneficiary_account_number: refundBankAccount.accountNumber,
    beneficiary_account_name: refundBankAccount.accountHolderName
  };

  let result = await supabaseAdminClient.from("refund_requests").upsert(extendedPayload, {
    onConflict: "order_id"
  });

  if (result.error && isMissingRefundBankColumnsError(result.error)) {
    result = await supabaseAdminClient.from("refund_requests").upsert(
      {
        ...payload,
        note: encodeRefundRequestNote({
          note: payload.note || null,
          bankAccount: refundBankAccount
        })
      },
      { onConflict: "order_id" }
    );
  }

  return result;
}

function buildCheckoutFormResponse({ invoiceNumber, amountVnd, successUrl, errorUrl, cancelUrl }) {
  if (!env.sepayMerchantId || !env.sepayMerchantSecretKey) {
    return null;
  }

  const payload = buildSepayCheckoutPayload({
    invoiceNumber,
    amountVnd,
    description: `Thanh toan don ${invoiceNumber}`,
    successUrl,
    errorUrl,
    cancelUrl
  });

  return buildSepayCheckoutForm(payload);
}

export async function expireUnpaidBookings() {
  const nowIso = new Date().toISOString();
  const { data: expiredPaymentRows, error: expiredPaymentsError } = await supabaseAdminClient
    .from("payments")
    .update({ status: "expired" })
    .eq("status", "awaiting")
    .lt("expires_at", nowIso)
    .select("order_id");

  if (expiredPaymentsError || !expiredPaymentRows || expiredPaymentRows.length === 0) {
    return;
  }

  const orderIds = expiredPaymentRows.map((row) => row.order_id);
  await supabaseAdminClient
    .from("bookings")
    .update({ status: "cancelled", payment_status: "expired" })
    .in("order_id", orderIds)
    .eq("payment_status", "awaiting");
}

bookingsRouter.post(
  "/",
  requireAuth,
  validateBody(createBookingBodySchema),
  asyncHandler(async (req, res) => {
    await expireUnpaidBookings();

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
      .select("id, field_id, start_time, end_time, status, price_vnd")
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
    const paymentExpiresAt = new Date(Date.now() + Math.max(1, env.paymentHoldMinutes) * 60 * 1000).toISOString();
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
            status: "pending",
            payment_status: "awaiting",
            payment_expires_at: paymentExpiresAt
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
    const amountVnd = sorted.reduce((sum, row) => sum + Number(row.price_vnd ?? 0), 0);
    const invoiceNumber = `OBI-${orderId.slice(0, 8).toUpperCase()}-${Date.now()}`;
    const { successUrl, errorUrl, cancelUrl } = buildPaymentCallbackUrls(orderId);
    const checkoutForm = buildCheckoutFormResponse({
      invoiceNumber,
      amountVnd,
      successUrl,
      errorUrl,
      cancelUrl
    });
    const checkoutUrl =
      env.sepayMerchantId && env.sepayMerchantSecretKey ? buildInternalCheckoutUrl(orderId) : null;

    const fallbackQrUrl =
      env.sepayBankCode && env.sepayAccountNo
        ? buildVietQrPreviewUrl({
            accountNo: env.sepayAccountNo,
            bankCode: env.sepayBankCode,
            amountVnd,
            addInfo: invoiceNumber,
            accountName: env.sepayAccountName
          })
        : null;

    const { error: paymentInsertError } = await supabaseAdminClient.from("payments").insert({
      order_id: orderId,
      provider: "sepay_pg",
      amount_vnd: amountVnd,
      sepay_order_id: null,
      invoice_number: invoiceNumber,
      checkout_url: checkoutUrl,
      return_success_url: successUrl,
      return_error_url: errorUrl,
      return_cancel_url: cancelUrl,
      status: "awaiting",
      expires_at: paymentExpiresAt
    });

    if (paymentInsertError) {
      await supabaseAdminClient.from("bookings").delete().in("id", createdIds);
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to create payment record");
    }

    return res.status(201).json({
      id: orderId,
      orderId,
      bookingIds: createdIds,
      slotIds: slotPkIds,
      status: "pending",
      paymentStatus: "awaiting",
      userId: req.auth.user.id,
      createdAt: firstCreatedAt,
      rangeStart: firstRow.start_time,
      rangeEnd: lastRow.end_time,
      payment: {
        invoiceNumber,
        amountVnd,
        checkoutUrl,
        checkoutForm,
        qrUrl: fallbackQrUrl,
        expiresAt: paymentExpiresAt,
        paymentMethod: env.sepayPaymentMethod || "BANK_TRANSFER"
      }
    });
  })
);

bookingsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    await expireUnpaidBookings();
    const { data: bookingRows, error: bookingError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id, status, payment_status, payment_paid_at, payment_expires_at, created_at, note, slot_id, cancel_requested_at, cancel_request_note, cancel_request_status")
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
          paymentStatus: booking.payment_status || "awaiting",
          paymentPaidAt: booking.payment_paid_at || null,
          paymentExpiresAt: booking.payment_expires_at || null,
          createdAt: booking.created_at || null,
          note: booking.note ?? null,
          cancelRequest: {
            status: booking.cancel_request_status || null,
            requestedAt: booking.cancel_requested_at || null,
            note: booking.cancel_request_note ?? null
          },
          refundRequest: null,
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
      if (booking.cancel_request_status === "pending") {
        existing.cancelRequest.status = "pending";
      } else if (booking.cancel_request_status === "approved" && existing.cancelRequest.status !== "pending") {
        existing.cancelRequest.status = "approved";
      } else if (
        booking.cancel_request_status === "rejected" &&
        !existing.cancelRequest.status
      ) {
        existing.cancelRequest.status = "rejected";
      }
      if (booking.cancel_requested_at) {
        const currentRequestedAt = existing.cancelRequest.requestedAt
          ? new Date(existing.cancelRequest.requestedAt).getTime()
          : Number.NEGATIVE_INFINITY;
        const nextRequestedAt = new Date(booking.cancel_requested_at).getTime();
        if (nextRequestedAt > currentRequestedAt) {
          existing.cancelRequest.requestedAt = booking.cancel_requested_at;
        }
      }
      if (!existing.cancelRequest.note && booking.cancel_request_note) {
        existing.cancelRequest.note = booking.cancel_request_note;
      }
      if (booking.status === "pending" || existing.status === "pending") {
        existing.status = "pending";
      } else if (booking.status === "confirmed" || existing.status === "confirmed") {
        existing.status = "confirmed";
      } else {
        existing.status = "cancelled";
      }
      if (booking.payment_status === "paid" || existing.paymentStatus === "paid") {
        existing.paymentStatus = "paid";
      } else if (booking.payment_status === "expired" || existing.paymentStatus === "expired") {
        existing.paymentStatus = "expired";
      } else if (booking.payment_status === "refunded" || existing.paymentStatus === "refunded") {
        existing.paymentStatus = "refunded";
      } else {
        existing.paymentStatus = "awaiting";
      }
    }

    let items = Array.from(orderMap.values()).sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    const orderIds = items.map((item) => item.id);
    if (orderIds.length > 0) {
      const { data: refundRows, error: refundError } = await fetchRefundRequestRowsByOrderIds(orderIds);

      if (refundError) {
        return sendError(res, 500, ERROR_CODES.dbError, "Failed to fetch refund request details");
      }

      const refundByOrderId = new Map((refundRows || []).map((row) => [row.order_id, mapRefundRequestRow(row)]));
      items = items.map((item) => ({
        ...item,
        refundRequest: refundByOrderId.get(item.id) || null
      }));
    }

    return res.status(200).json({ items });
  })
);

bookingsRouter.get(
  "/:bookingId/payment",
  requireAuth,
  validateParams(bookingOrderParamsSchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid payment detail request");
    }
    await expireUnpaidBookings();
    const { bookingId } = req.validatedParams;
    const { data: matchedRows, error: matchedError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id")
      .eq("user_id", req.auth.user.id)
      .or(`id.eq.${bookingId},order_id.eq.${bookingId}`)
      .limit(1);

    const matched = matchedRows?.[0];
    if (matchedError || !matched) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Booking not found");
    }
    const orderId = matched.order_id || matched.id;

    const { data: paymentRow, error: paymentError } = await supabaseAdminClient
      .from("payments")
      .select(
        "order_id, invoice_number, amount_vnd, checkout_url, status, paid_at, expires_at, return_success_url, return_error_url, return_cancel_url"
      )
      .eq("order_id", orderId)
      .maybeSingle();

    if (paymentError || !paymentRow) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Payment not found");
    }

    const qrUrl =
      env.sepayBankCode && env.sepayAccountNo
        ? buildVietQrPreviewUrl({
            accountNo: env.sepayAccountNo,
            bankCode: env.sepayBankCode,
            amountVnd: Number(paymentRow.amount_vnd || 0),
            addInfo: paymentRow.invoice_number,
            accountName: env.sepayAccountName
          })
        : null;
    const checkoutForm = buildCheckoutFormResponse({
      invoiceNumber: paymentRow.invoice_number,
      amountVnd: Number(paymentRow.amount_vnd || 0),
      successUrl: paymentRow.return_success_url || buildPaymentCallbackUrls(orderId).successUrl,
      errorUrl: paymentRow.return_error_url || buildPaymentCallbackUrls(orderId).errorUrl,
      cancelUrl: paymentRow.return_cancel_url || buildPaymentCallbackUrls(orderId).cancelUrl
    });

    return res.status(200).json({
      id: orderId,
      payment: {
        invoiceNumber: paymentRow.invoice_number,
        amountVnd: Number(paymentRow.amount_vnd || 0),
        checkoutUrl: paymentRow.checkout_url || buildInternalCheckoutUrl(orderId),
        hasCheckoutUrl: Boolean(paymentRow.checkout_url || env.sepayMerchantId),
        checkoutForm,
        qrUrl,
        paymentMethod: env.sepayPaymentMethod || "BANK_TRANSFER",
        status: paymentRow.status,
        paidAt: paymentRow.paid_at || null,
        expiresAt: paymentRow.expires_at || null
      }
    });
  })
);

bookingsRouter.get(
  "/:bookingId/refund-quote",
  requireAuth,
  validateParams(bookingOrderParamsSchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid refund quote request");
    }
    const { bookingId } = req.validatedParams;
    const { data: matchedRows, error: matchedError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id")
      .eq("user_id", req.auth.user.id)
      .or(`id.eq.${bookingId},order_id.eq.${bookingId}`)
      .limit(1);

    const matched = matchedRows?.[0];
    if (matchedError || !matched) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Booking not found");
    }
    const orderId = matched.order_id || matched.id;
    const orderFilter = matched.order_id ? { column: "order_id", value: matched.order_id } : { column: "id", value: matched.id };

    const { data: rows, error: rowsError } = await supabaseAdminClient
      .from("bookings")
      .select("id, payment_status, time_slots:slot_id(start_time, price_vnd)")
      .eq("user_id", req.auth.user.id)
      .eq(orderFilter.column, orderFilter.value);

    if (rowsError || !rows || rows.length === 0) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to resolve booking for refund quote");
    }

    const paymentStatus = rows[0]?.payment_status || "awaiting";
    let totalAmountVnd = 0;
    let startMs = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const slot = Array.isArray(row.time_slots) ? row.time_slots[0] : row.time_slots;
      totalAmountVnd += Number(slot?.price_vnd ?? 0);
      if (slot?.start_time) {
        startMs = Math.min(startMs, new Date(slot.start_time).getTime());
      }
    }
    const feePercent = Number.isFinite(startMs) && Date.now() >= startMs - 24 * 60 * 60 * 1000 ? 30 : 0;
    const refundAmountVnd = Math.max(0, Math.round(totalAmountVnd * (100 - feePercent) / 100));

    return res.status(200).json({
      id: orderId,
      paymentStatus,
      refundQuote: {
        totalAmountVnd,
        feePercent,
        refundAmountVnd
      }
    });
  })
);

bookingsRouter.post(
  "/:bookingId/cancel-request",
  requireAuth,
  validateParams(bookingParamsSchema),
  validateBody(cancelRequestBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid cancel request payload",
        { fields: req.validationError }
      );
    }

    const { bookingId } = req.validatedParams;
    const { note, refundBankAccount } = req.validatedBody;
    const { data: matchedRows, error: matchedError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id, status, payment_status, user_id, cancel_requested_at, cancel_request_note, cancel_request_status")
      .eq("user_id", req.auth.user.id)
      .or(`id.eq.${bookingId},order_id.eq.${bookingId}`)
      .limit(1);

    const matched = matchedRows?.[0];
    if (matchedError || !matched) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Booking not found");
    }

    const orderId = matched.order_id || matched.id;
    const orderFilter = matched.order_id ? { column: "order_id", value: matched.order_id } : { column: "id", value: matched.id };
    const { data: orderRows, error: orderError } = await supabaseAdminClient
      .from("bookings")
      .select("id, status, payment_status, cancel_requested_at, cancel_request_note, cancel_request_status, time_slots:slot_id(start_time, price_vnd)")
      .eq("user_id", req.auth.user.id)
      .eq(orderFilter.column, orderFilter.value);

    if (orderError || !orderRows || orderRows.length === 0) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to resolve booking order");
    }

    if (orderRows.some((row) => row.status === "cancelled")) {
      return sendError(
        res,
        409,
        ERROR_CODES.invalidStatusTransition,
        "Đơn đã hủy nên không thể gửi yêu cầu hủy thêm"
      );
    }

    const paymentStatus = orderRows[0]?.payment_status || "awaiting";
    if (paymentStatus === "awaiting" || paymentStatus === "expired") {
      return sendError(
        res,
        409,
        ERROR_CODES.paymentNotPaid,
        "Đơn chưa thanh toán nên không thể gửi yêu cầu hoàn tiền"
      );
    }

    const currentCancelRequest = aggregateCancelRequest(orderRows);
    if (currentCancelRequest.status === "pending") {
      return res.status(200).json({
        id: orderId,
        updatedCount: 0,
        cancelRequest: currentCancelRequest
      });
    }

    let totalAmountVnd = 0;
    let startMs = Number.POSITIVE_INFINITY;
    for (const row of orderRows) {
      const slot = Array.isArray(row.time_slots) ? row.time_slots[0] : row.time_slots;
      totalAmountVnd += Number(slot?.price_vnd ?? 0);
      if (slot?.start_time) {
        startMs = Math.min(startMs, new Date(slot.start_time).getTime());
      }
    }
    const feePercent = Number.isFinite(startMs) && Date.now() >= startMs - 24 * 60 * 60 * 1000 ? 30 : 0;
    const refundAmountVnd = Math.max(0, Math.round(totalAmountVnd * (100 - feePercent) / 100));
    const normalizedRefundBankAccount = normalizeRefundBankAccount(refundBankAccount);
    const requestedAt = new Date().toISOString();

    const { error: refundUpsertError } = await upsertRefundRequestWithFallback(
      {
        order_id: orderId,
        total_amount_vnd: totalAmountVnd,
        fee_percent: feePercent,
        refund_amount_vnd: refundAmountVnd,
        status: "pending",
        note: note || null,
        requested_at: requestedAt
      },
      normalizedRefundBankAccount
    );

    if (refundUpsertError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to create refund request");
    }

    const { data: updatedRows, error: updateError } = await supabaseAdminClient
      .from("bookings")
      .update({
        cancel_requested_at: requestedAt,
        cancel_request_note: note || null,
        cancel_request_status: "pending"
      })
      .eq("user_id", req.auth.user.id)
      .eq(orderFilter.column, orderFilter.value)
      .select("id, cancel_requested_at, cancel_request_note, cancel_request_status");

    if (updateError) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to create cancel request");
    }

    return res.status(200).json({
      id: orderId,
      updatedCount: (updatedRows || []).length,
      cancelRequest: aggregateCancelRequest(updatedRows || []),
      refundRequest: {
        totalAmountVnd,
        feePercent,
        refundAmountVnd,
        status: "pending",
        requestedAt,
        decidedAt: null,
        note: note || null,
        bankAccount: normalizedRefundBankAccount
      }
    });
  })
);
