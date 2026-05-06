import { Router } from "express";
import { z } from "zod";
import { supabaseAdminClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { expireUnpaidBookings } from "./bookings.js";
import {
  buildSepayCheckoutForm,
  buildSepayCheckoutPayload,
  deriveWebhookEventId,
  extractSepayOrderStatusFromDetail,
  extractSepayInvoiceNumber,
  extractSepayTransactionStatusFromDetail,
  renderSepayCheckoutHtml,
  renderSepayStatusHtml,
  retrieveSepayOrder,
  shouldMarkSepayPayloadAsPaid,
  shouldTreatSepayOrderAsPaid,
  verifySepayIpn
} from "../lib/sepayGateway.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, uuidLikeSchema, validateBody, validateParams, validateQuery } from "../utils/validate.js";

export const paymentsRouter = Router();

const sepayIpnSchema = z.object({
  notification_type: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  code: z.string().optional(),
  transferType: z.string().optional(),
  order: z
    .object({
      id: z.string().optional(),
      order_invoice_number: z.string().optional(),
      order_status: z.string().optional()
    })
    .passthrough()
    .optional(),
  transaction: z
    .object({
      id: z.string().optional(),
      transaction_status: z.string().optional()
    })
    .passthrough()
    .optional()
}).passthrough();
const checkoutParamsSchema = z.object({
  orderId: uuidLikeSchema
});
const checkoutCallbackParamsSchema = z.object({
  state: z.enum(["success", "error", "cancel"])
});
const checkoutCallbackQuerySchema = z.object({
  orderId: uuidLikeSchema.optional()
});
const reconcileParamsSchema = z.object({
  orderId: uuidLikeSchema
});

async function markOrderAsPaid(orderId) {
  const { data: bookingRows, error: bookingReadError } = await supabaseAdminClient
    .from("bookings")
    .select("status, payment_status")
    .eq("order_id", orderId);

  if (bookingReadError || !bookingRows || bookingRows.length === 0) {
    throw new Error("Failed to resolve order bookings");
  }

  if (bookingRows.some((row) => row.status !== "pending" || row.payment_status !== "awaiting")) {
    return false;
  }

  const paidAt = new Date().toISOString();

  const { error: paymentUpdateError } = await supabaseAdminClient
    .from("payments")
    .update({ status: "paid", paid_at: paidAt })
    .eq("order_id", orderId);

  if (paymentUpdateError) {
    throw new Error("Failed to update payment status");
  }

  const { error: bookingUpdateError } = await supabaseAdminClient
    .from("bookings")
    .update({ payment_status: "paid", payment_paid_at: paidAt })
    .eq("order_id", orderId);

  if (bookingUpdateError) {
    throw new Error("Failed to update booking payment status");
  }

  return true;
}

paymentsRouter.get(
  "/sepay/checkout/:orderId",
  validateParams(checkoutParamsSchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid payment checkout request");
    }

    const { orderId } = req.validatedParams;
    await expireUnpaidBookings();
    const { data: paymentRow, error: paymentError } = await supabaseAdminClient
      .from("payments")
      .select("order_id, amount_vnd, invoice_number, status, expires_at, return_success_url, return_error_url, return_cancel_url")
      .eq("order_id", orderId)
      .maybeSingle();

    if (paymentError || !paymentRow) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Payment not found");
    }

    if (paymentRow.status === "paid") {
      res.setHeader("Cache-Control", "no-store");
      res.type("html").status(200).send(
        renderSepayStatusHtml({
          state: "success",
          orderId,
          invoiceNumber: paymentRow.invoice_number
        })
      );
      return;
    }

    if (paymentRow.status === "expired" || paymentRow.status === "refunded") {
      res.setHeader("Cache-Control", "no-store");
      res.type("html").status(410).send(
        renderSepayStatusHtml({
          state: paymentRow.status === "expired" ? "error" : "cancel",
          orderId,
          invoiceNumber: paymentRow.invoice_number
        })
      );
      return;
    }

    const payload = buildSepayCheckoutPayload({
      invoiceNumber: paymentRow.invoice_number,
      amountVnd: Number(paymentRow.amount_vnd || 0),
      description: `Thanh toan don ${paymentRow.invoice_number}`,
      successUrl: paymentRow.return_success_url,
      errorUrl: paymentRow.return_error_url,
      cancelUrl: paymentRow.return_cancel_url
    });
    const form = buildSepayCheckoutForm(payload);

    res.setHeader("Cache-Control", "no-store");
    res.type("html").status(200).send(
      renderSepayCheckoutHtml({
        actionUrl: form.actionUrl,
        fields: form.fields,
        invoiceNumber: paymentRow.invoice_number,
        amountVnd: Number(paymentRow.amount_vnd || 0)
      })
    );
  })
);

paymentsRouter.get(
  "/sepay/callback/:state",
  validateParams(checkoutCallbackParamsSchema),
  validateQuery(checkoutCallbackQuerySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid SePay callback");
    }

    const { state } = req.validatedParams;
    const { orderId } = req.validatedQuery;

    let invoiceNumber = null;
    if (orderId) {
      const { data: paymentRow } = await supabaseAdminClient
        .from("payments")
        .select("invoice_number")
        .eq("order_id", orderId)
        .maybeSingle();
      invoiceNumber = paymentRow?.invoice_number || null;
    }

    res.setHeader("Cache-Control", "no-store");
    res.type("html").status(200).send(
      renderSepayStatusHtml({
        state,
        orderId: orderId || null,
        invoiceNumber
      })
    );
  })
);

paymentsRouter.post(
  "/sepay/reconcile/:orderId",
  requireAuth,
  validateParams(reconcileParamsSchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid payment reconcile request");
    }

    await expireUnpaidBookings();
    const { orderId: bookingOrOrderId } = req.validatedParams;
    const { data: matchedRows, error: matchedError } = await supabaseAdminClient
      .from("bookings")
      .select("id, order_id")
      .eq("user_id", req.auth.user.id)
      .or(`id.eq.${bookingOrOrderId},order_id.eq.${bookingOrOrderId}`)
      .limit(1);

    const matched = matchedRows?.[0];
    if (matchedError || !matched) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Booking not found");
    }

    const orderId = matched.order_id || matched.id;
    const { data: paymentRow, error: paymentError } = await supabaseAdminClient
      .from("payments")
      .select("order_id, invoice_number, status, paid_at")
      .eq("order_id", orderId)
      .maybeSingle();

    if (paymentError || !paymentRow) {
      return sendError(res, 404, ERROR_CODES.bookingNotFound, "Payment not found");
    }

    if (paymentRow.status === "paid") {
      return res.status(200).json({
        ok: true,
        payment: {
          orderId,
          invoiceNumber: paymentRow.invoice_number,
          status: "paid",
          paidAt: paymentRow.paid_at || null,
          reconciled: false
        }
      });
    }

    try {
      const sepayDetail = await retrieveSepayOrder(paymentRow.invoice_number);
      const paid = shouldTreatSepayOrderAsPaid(sepayDetail);

      if (paid) {
        await markOrderAsPaid(orderId);
      }

      const { data: refreshedPaymentRow } = await supabaseAdminClient
        .from("payments")
        .select("status, paid_at")
        .eq("order_id", orderId)
        .maybeSingle();

      return res.status(200).json({
        ok: true,
        payment: {
          orderId,
          invoiceNumber: paymentRow.invoice_number,
          status: refreshedPaymentRow?.status || paymentRow.status,
          paidAt: refreshedPaymentRow?.paid_at || paymentRow.paid_at || null,
          reconciled: paid,
          sepayOrderStatus: extractSepayOrderStatusFromDetail(sepayDetail),
          sepayTransactionStatus: extractSepayTransactionStatusFromDetail(sepayDetail)
        }
      });
    } catch (error) {
      return sendError(
        res,
        502,
        ERROR_CODES.internalError,
        error instanceof Error ? error.message : "Failed to reconcile payment with SePay"
      );
    }
  })
);

paymentsRouter.post(
  "/sepay/webhook",
  validateBody(sepayIpnSchema),
  asyncHandler(async (req, res) => {
    if (!verifySepayIpn(req)) {
      return sendError(res, 401, ERROR_CODES.webhookInvalid, "Invalid SePay IPN signature");
    }
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid SePay IPN payload");
    }

    const payload = req.validatedBody;
    await expireUnpaidBookings();
    const eventId = deriveWebhookEventId(payload);
    const invoiceNumber = extractSepayInvoiceNumber(payload);
    const shouldCapture = shouldMarkSepayPayloadAsPaid(payload);

    const { error: eventInsertError } = await supabaseAdminClient
      .from("payment_webhook_events")
      .insert({
        id: eventId,
        payload
      });

    if (eventInsertError) {
      if (eventInsertError.code === "23505") {
        return res.status(200).json({ ok: true, duplicated: true });
      }
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to persist webhook event");
    }

    if (!shouldCapture || !invoiceNumber) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const { data: paymentRow, error: paymentReadError } = await supabaseAdminClient
      .from("payments")
      .select("order_id, status")
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();

    if (paymentReadError || !paymentRow) {
      return res.status(200).json({ ok: true, unmatched: true });
    }

    await supabaseAdminClient
      .from("payment_webhook_events")
      .update({ matched_order_id: paymentRow.order_id })
      .eq("id", eventId);

    if (paymentRow.status !== "awaiting") {
      return res.status(200).json({ ok: true, ignoredStatus: paymentRow.status });
    }

    try {
      const updated = await markOrderAsPaid(paymentRow.order_id);
      if (!updated) {
        return res.status(200).json({ ok: true, ignoredBookingState: true });
      }
    } catch (error) {
      return sendError(
        res,
        500,
        ERROR_CODES.dbError,
        error instanceof Error ? error.message : "Failed to update payment state"
      );
    }

    return res.status(200).json({ ok: true, orderId: paymentRow.order_id });
  })
);
