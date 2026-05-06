import crypto from "node:crypto";
import sepayPgNode from "sepay-pg-node";
import { env } from "../config/env.js";

const { SePayPgClient } = sepayPgNode;
let sepayCheckoutClient = null;

function toQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getSepayCheckoutClient() {
  if (!env.sepayMerchantId || !env.sepayMerchantSecretKey) {
    return null;
  }

  if (!sepayCheckoutClient) {
    sepayCheckoutClient = new SePayPgClient({
      env: env.sepayEnv === "production" ? "production" : "sandbox",
      merchant_id: env.sepayMerchantId,
      secret_key: env.sepayMerchantSecretKey
    });
  }

  return sepayCheckoutClient;
}

export function resolveSepayCheckoutInitUrl() {
  const client = getSepayCheckoutClient();
  if (client) {
    return client.checkout.initCheckoutUrl();
  }

  return env.sepayEnv === "production"
    ? "https://pay.sepay.vn/v1/checkout/init"
    : "https://pay-sandbox.sepay.vn/v1/checkout/init";
}

export function resolvePublicBaseUrl() {
  const fallback = `http://localhost:${env.port}`;
  try {
    const raw = env.appPublicBaseUrl?.trim() || fallback;
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return trimTrailingSlash(env.appPublicBaseUrl || fallback);
  }
}

export function buildSepayCheckoutPayload({
  invoiceNumber,
  amountVnd,
  description,
  successUrl,
  errorUrl,
  cancelUrl,
  paymentMethod = env.sepayPaymentMethod || "BANK_TRANSFER"
}) {
  return {
    merchant: env.sepayMerchantId,
    operation: "PURCHASE",
    payment_method: paymentMethod,
    order_invoice_number: invoiceNumber,
    order_amount: amountVnd,
    currency: "VND",
    order_description: description,
    success_url: successUrl,
    error_url: errorUrl,
    cancel_url: cancelUrl
  };
}

export function buildSepayCheckoutForm(payload) {
  const client = getSepayCheckoutClient();

  return {
    actionUrl: client ? client.checkout.initCheckoutUrl() : resolveSepayCheckoutInitUrl(),
    fields: client ? client.checkout.initOneTimePaymentFields({ ...payload }) : payload
  };
}

export async function retrieveSepayOrder(invoiceNumber) {
  const client = getSepayCheckoutClient();
  if (!client || !invoiceNumber) {
    return null;
  }

  const response = await client.order.retrieve(invoiceNumber);
  return response?.data ?? null;
}

function findFirstString(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

export function extractSepayOrderStatusFromDetail(payload) {
  return findFirstString([
    payload?.order_status,
    payload?.status,
    payload?.order?.order_status,
    payload?.data?.order_status,
    payload?.data?.status,
    payload?.data?.order?.order_status
  ]).toUpperCase();
}

export function extractSepayTransactionStatusFromDetail(payload) {
  return findFirstString([
    payload?.transaction_status,
    payload?.transaction?.transaction_status,
    payload?.data?.transaction_status,
    payload?.data?.transaction?.transaction_status
  ]).toUpperCase();
}

export function shouldTreatSepayOrderAsPaid(payload) {
  const orderStatus = extractSepayOrderStatusFromDetail(payload);
  const transactionStatus = extractSepayTransactionStatusFromDetail(payload);

  return ["CAPTURED", "PAID", "SUCCESS", "SUCCEEDED", "COMPLETED"].includes(orderStatus) ||
    ["APPROVED", "CAPTURED", "SUCCESS", "SUCCEEDED", "COMPLETED"].includes(transactionStatus);
}

export function buildInternalCheckoutUrl(orderId) {
  return `${resolvePublicBaseUrl()}/api/v1/payments/sepay/checkout/${orderId}`;
}

export function buildPaymentCallbackUrls(orderId) {
  const baseUrl = resolvePublicBaseUrl();
  const query = `orderId=${encodeURIComponent(orderId)}`;
  return {
    successUrl: `${baseUrl}/api/v1/payments/sepay/callback/success?${query}`,
    errorUrl: `${baseUrl}/api/v1/payments/sepay/callback/error?${query}`,
    cancelUrl: `${baseUrl}/api/v1/payments/sepay/callback/cancel?${query}`
  };
}

export function renderSepayCheckoutHtml({ actionUrl, fields, invoiceNumber, amountVnd }) {
  const hiddenInputs = Object.entries(fields)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}" />`
    )
    .join("\n");

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Dang mo cong thanh toan SePay</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f7fb;
        --ink: #16324f;
        --muted: #5f7288;
        --line: #d5e1ee;
        --card: #ffffff;
        --accent: #0b8a62;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(11, 138, 98, 0.08), transparent 35%),
          radial-gradient(circle at bottom right, rgba(32, 117, 255, 0.09), transparent 34%),
          var(--bg);
        color: var(--ink);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        width: min(100%, 460px);
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px 24px;
        box-shadow: 0 18px 44px rgba(9, 30, 66, 0.09);
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        background: rgba(11, 138, 98, 0.1);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 8px 12px;
      }
      h1 {
        margin: 18px 0 10px;
        font-size: 28px;
        line-height: 1.15;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .summary {
        margin-top: 18px;
        padding: 16px;
        border-radius: 18px;
        background: #f8fbff;
        border: 1px solid #e4edf7;
      }
      .summary strong {
        display: block;
        margin-top: 4px;
        font-size: 16px;
        color: var(--ink);
      }
      .spinner {
        width: 52px;
        height: 52px;
        border-radius: 999px;
        border: 4px solid rgba(11, 138, 98, 0.16);
        border-top-color: var(--accent);
        margin: 22px auto 18px;
        animation: spin 0.9s linear infinite;
      }
      form {
        margin-top: 12px;
      }
      button {
        width: 100%;
        border: 0;
        border-radius: 16px;
        background: var(--accent);
        color: white;
        font-size: 16px;
        font-weight: 800;
        padding: 14px 18px;
        cursor: pointer;
      }
      .hint {
        margin-top: 14px;
        font-size: 13px;
        text-align: center;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="eyebrow">SePay QR</div>
      <h1>Dang chuyen ban toi cong thanh toan</h1>
      <p>Trang SePay se mo QR chuyen khoan va tu dong doi soat khi giao dich thanh cong.</p>
      <div class="summary">
        Ma don
        <strong>${escapeHtml(invoiceNumber || "--")}</strong>
      </div>
      <div class="summary">
        So tien
        <strong>${escapeHtml(
          new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amountVnd || 0)
        )}</strong>
      </div>
      <div class="spinner" aria-hidden="true"></div>
      <form id="checkout-form" method="post" action="${escapeHtml(actionUrl)}">
        ${hiddenInputs}
        <button type="submit">Mo QR thanh toan</button>
      </form>
      <p class="hint">Neu trinh duyet khong tu dong chuyen trang, hay nhan vao nut ben tren.</p>
    </div>
    <script>
      window.setTimeout(function () {
        var form = document.getElementById("checkout-form");
        if (form) form.submit();
      }, 120);
    </script>
  </body>
</html>`;
}

export function renderSepayStatusHtml({ state, orderId, invoiceNumber }) {
  const dictionary = {
    success: {
      title: "Da tiep nhan thanh toan",
      accent: "#0b8a62",
      body: "He thong dang doi IPN tu SePay de cap nhat don hang. Ban co the quay lai ung dung de theo doi trang thai."
    },
    error: {
      title: "Thanh toan chua thanh cong",
      accent: "#d66a0c",
      body: "Vui long quay lai ung dung va thu lai. Don cua ban van duoc giu cho toi khi het han thanh toan."
    },
    cancel: {
      title: "Ban da huy giao dich",
      accent: "#b74b45",
      body: "Neu ban van muon giu lich, hay quay lai ung dung de thanh toan lai truoc khi het han."
    }
  };
  const copy = dictionary[state] || dictionary.error;

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${escapeHtml(copy.title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #f4f7fb;
        color: #16324f;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        width: min(100%, 460px);
        background: white;
        border-radius: 24px;
        border: 1px solid #d7e2ee;
        padding: 28px 24px;
        box-shadow: 0 18px 42px rgba(11, 33, 56, 0.08);
      }
      .dot {
        width: 58px;
        height: 58px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        color: white;
        font-size: 28px;
        font-weight: 800;
        background: ${escapeHtml(copy.accent)};
      }
      h1 {
        margin: 18px 0 10px;
        font-size: 30px;
        line-height: 1.15;
      }
      p {
        margin: 0;
        color: #5f7288;
        line-height: 1.65;
      }
      .meta {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px dashed #dbe5f0;
      }
      .meta strong {
        display: block;
        margin-top: 6px;
        color: #16324f;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="dot">${state === "success" ? "✓" : state === "cancel" ? "!" : "?"}</div>
      <h1>${escapeHtml(copy.title)}</h1>
      <p>${escapeHtml(copy.body)}</p>
      <div class="meta">
        Don hang
        <strong>${escapeHtml(invoiceNumber || orderId || "--")}</strong>
      </div>
    </div>
  </body>
</html>`;
}

export function verifySepayIpn(req) {
  if (!env.sepayIpnSecret) {
    return true;
  }
  const candidates = [
    req.headers["x-secret-key"],
    req.headers["x-sepay-signature"],
    req.headers["x-signature"],
    req.headers.authorization
  ];

  return candidates.some((candidate) => {
    const raw = Array.isArray(candidate) ? candidate[0] : candidate;
    if (!raw) {
      return false;
    }
    const normalized = String(raw).replace(/^Bearer\s+/i, "").trim();
    return normalized === env.sepayIpnSecret;
  });
}

export function deriveWebhookEventId(payload) {
  if (payload?.id) {
    return String(payload.id);
  }
  const txId = payload?.transaction?.id;
  if (txId) {
    return String(txId);
  }
  const raw = JSON.stringify(payload || {});
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function extractSepayInvoiceNumber(payload) {
  if (payload?.order?.order_invoice_number) {
    return String(payload.order.order_invoice_number).trim();
  }
  if (payload?.code) {
    return String(payload.code).trim();
  }
  return null;
}

export function shouldMarkSepayPayloadAsPaid(payload) {
  if (payload?.notification_type === "ORDER_PAID") {
    return payload?.order?.order_status === "CAPTURED" && payload?.transaction?.transaction_status === "APPROVED";
  }

  const transferType = typeof payload?.transferType === "string" ? payload.transferType.toLowerCase() : "";
  return Boolean(extractSepayInvoiceNumber(payload)) && (transferType === "in" || transferType === "incoming");
}

export function buildVietQrPreviewUrl({ accountNo, bankCode, amountVnd, addInfo, accountName }) {
  const query = toQuery({
    acc: accountNo,
    bank: bankCode,
    amount: amountVnd,
    des: addInfo,
    template: "compact2",
    accountName
  });
  return `https://qr.sepay.vn/img?${query}`;
}
