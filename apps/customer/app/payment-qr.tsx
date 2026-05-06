import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { WebViewMessageEvent } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { getOrderPaymentApi, reconcileOrderPaymentApi } from "../src/lib/api";
import { useAuth } from "../src/store/auth";

const EmbeddedWebView = Platform.OS === "web" ? null : require("react-native-webview").WebView;
const INITIAL_CHECKOUT_HEIGHT = Math.round(Dimensions.get("window").height * 0.68);

export default function PaymentQrScreen() {
  const insets = useSafeAreaInsets();
  const { getValidAccessToken } = useAuth();
  const successHandledRef = useRef(false);
  const params = useLocalSearchParams<{
    orderId?: string;
    bookingId?: string;
    venueId?: string;
    venueName?: string;
    selectedDate?: string;
    totalPrice?: string;
    amountVnd?: string;
    checkoutUrl?: string;
    checkoutActionUrl?: string;
    checkoutFieldsJson?: string;
    qrUrl?: string;
    invoiceNumber?: string;
    expiresAt?: string;
    paymentMethod?: string;
  }>();

  const orderId = params.orderId || params.bookingId || "";
  const [now, setNow] = useState(() => Date.now());
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [expiredHandled, setExpiredHandled] = useState(false);
  const [embeddedCheckoutFailed, setEmbeddedCheckoutFailed] = useState(false);
  const [checkoutLoaded, setCheckoutLoaded] = useState(false);
  const [checkoutHeight, setCheckoutHeight] = useState(INITIAL_CHECKOUT_HEIGHT);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const paymentQuery = useQuery({
    queryKey: ["booking-payment", orderId],
    enabled: !!orderId,
    refetchInterval: (query) => (query.state.data?.payment?.status === "awaiting" ? 4000 : false),
    queryFn: async () => {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        throw new Error("Phiên đăng nhập đã hết hạn.");
      }
      return getOrderPaymentApi(accessToken, orderId);
    }
  });

  const payment = paymentQuery.data?.payment;
  const paymentStatus = payment?.status || "awaiting";
  const amount = Number(payment?.amountVnd || params.amountVnd || params.totalPrice || 0);
  const checkoutActionUrl = payment?.checkoutForm?.actionUrl || params.checkoutActionUrl || "";
  const qrUrl = payment?.qrUrl || params.qrUrl || "";
  const checkoutFieldsJson =
    payment?.checkoutForm?.fields ? JSON.stringify(payment.checkoutForm.fields) : params.checkoutFieldsJson || "";
  const invoiceNumber = payment?.invoiceNumber || params.invoiceNumber || orderId;
  const expiresAt = payment?.expiresAt || params.expiresAt || null;
  const receiverNameToHide = useMemo(() => extractQrAccountName(qrUrl), [qrUrl]);
  const checkoutBridgeScript = useMemo(() => buildCheckoutBridgeScript(receiverNameToHide), [receiverNameToHide]);

  const checkoutFields = useMemo(() => parseCheckoutFields(checkoutFieldsJson), [checkoutFieldsJson]);
  const checkoutHtmlDocument = useMemo(
    () => buildCheckoutHtmlDocument(checkoutActionUrl, checkoutFields),
    [checkoutActionUrl, checkoutFields]
  );
  const checkoutWebViewSource = useMemo(
    () => (checkoutHtmlDocument ? { html: checkoutHtmlDocument, baseUrl: checkoutActionUrl || undefined } : undefined),
    [checkoutActionUrl, checkoutHtmlDocument]
  );
  const showEmbeddedCheckout =
    Platform.OS !== "web" &&
    Boolean(EmbeddedWebView) &&
    Boolean(checkoutWebViewSource) &&
    !embeddedCheckoutFailed;
  const statusMeta = getStatusMeta(paymentStatus);

  useEffect(() => {
    setEmbeddedCheckoutFailed(false);
    setCheckoutLoaded(false);
  }, [checkoutActionUrl, checkoutFieldsJson]);

  useEffect(() => {
    if (paymentStatus !== "paid") {
      return;
    }
    navigateToSuccess();
  }, [amount, orderId, params.selectedDate, params.venueId, params.venueName, paymentStatus]);

  useEffect(() => {
    if (paymentStatus !== "expired" || expiredHandled) {
      return;
    }
    setExpiredHandled(true);
    Alert.alert("Đơn đã hết hạn", "Phiên giữ chỗ đã kết thúc. Vui lòng đặt lại slot nếu bạn vẫn muốn tiếp tục.", [
      {
        text: "Đã hiểu",
        onPress: () => router.replace("/(tabs)/my-bookings")
      }
    ]);
  }, [expiredHandled, paymentStatus]);

  const leftMs = useMemo(() => {
    if (!expiresAt) return null;
    return new Date(expiresAt).getTime() - now;
  }, [expiresAt, now]);

  function navigateToSuccess() {
    if (successHandledRef.current) {
      return;
    }
    successHandledRef.current = true;
    router.replace({
      pathname: "/booking-success",
      params: {
        bookingId: orderId,
        venueId: params.venueId || "",
        venueName: params.venueName || "",
        selectedDate: params.selectedDate || "",
        totalPrice: String(amount)
      }
    });
  }

  async function reconcilePayment() {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      throw new Error("Phiên đăng nhập đã hết hạn.");
    }

    const result = await reconcileOrderPaymentApi(accessToken, orderId);
    await paymentQuery.refetch();
    if (result.payment.status === "paid") {
      navigateToSuccess();
    }
    return result;
  }

  async function reconcilePaymentWithRetries(maxAttempts = 3) {
    let lastResult: Awaited<ReturnType<typeof reconcileOrderPaymentApi>> | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      lastResult = await reconcilePayment();
      if (lastResult.payment.status === "paid") {
        return lastResult;
      }
      if (attempt < maxAttempts - 1) {
        await wait(1200);
      }
    }
    return lastResult;
  }

  async function handleSepaySuccessSignal() {
    if (successHandledRef.current) {
      return;
    }

    try {
      await reconcilePaymentWithRetries(4);
    } catch {
      await paymentQuery.refetch();
    }
  }

  async function handleCheckPayment() {
    try {
      setCheckingPayment(true);
      await reconcilePaymentWithRetries(2);
    } finally {
      setCheckingPayment(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: Math.max(insets.bottom, 16) + 118 }]}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color="#4D5E73" />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Quét mã thanh toán</Text>
              <Text style={styles.subtitle}>Quét mã và chuyển đúng nội dung.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={styles.statusCopy}>
                <Text style={styles.sectionLabel}>Thông tin thanh toán</Text>
                <Text style={styles.orderCode}>Mã đơn #{invoiceNumber.slice(0, 18).toUpperCase()}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusMeta.background }]}>
                <Text style={[styles.statusBadgeText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
              </View>
            </View>

            <Text style={styles.amount}>{formatPrice(amount)}</Text>
            <InfoRow label="Tên sân" value={params.venueName || "ObiSpot"} />
            <InfoRow label="Giữ chỗ đến" value={formatDateTime(expiresAt)} />
            <InfoRow label="Nội dung CK" value={invoiceNumber} />
            {leftMs !== null && paymentStatus === "awaiting" ? (
              <InfoRow label="Thời gian còn lại" value={formatCountdown(leftMs)} />
            ) : null}
          </View>

          {showEmbeddedCheckout ? (
            <View style={styles.checkoutSection}>
              <View style={[styles.webviewFrame, { height: checkoutHeight }]}>
                <EmbeddedWebView
                  originWhitelist={["*"]}
                  source={checkoutWebViewSource}
                  javaScriptEnabled
                  domStorageEnabled
                  setSupportMultipleWindows={false}
                  startInLoadingState
                  nestedScrollEnabled
                  scrollEnabled
                  thirdPartyCookiesEnabled
                  sharedCookiesEnabled
                  injectedJavaScript={checkoutBridgeScript}
                  onLoadStart={() => setCheckoutLoaded(false)}
                  onLoadEnd={() => setCheckoutLoaded(true)}
                  onMessage={(event: WebViewMessageEvent) => {
                    const payload = parseWebViewMessage(event.nativeEvent.data);
                    if (!payload) {
                      return;
                    }
                    if (payload.type === "status" && payload.status === "paid") {
                      void handleSepaySuccessSignal();
                      return;
                    }
                    if (payload.type === "height" && typeof payload.height === "number" && Number.isFinite(payload.height)) {
                      setCheckoutHeight((current) => {
                        const normalized = Math.min(Math.max(payload.height + 12, 520), INITIAL_CHECKOUT_HEIGHT);
                        return Math.abs(current - normalized) > 8 ? normalized : current;
                      });
                    }
                  }}
                  onNavigationStateChange={(state: WebViewNavigation) => {
                    if (/\/callback\/success\b/i.test(state.url)) {
                      void handleSepaySuccessSignal();
                    }
                  }}
                  onError={() => setEmbeddedCheckoutFailed(true)}
                  onHttpError={() => setEmbeddedCheckoutFailed(true)}
                  renderLoading={() => (
                    <View style={styles.webviewLoading}>
                      <ActivityIndicator color="#087B57" />
                      <Text style={styles.webviewLoadingText}>Đang tải trang thanh toán...</Text>
                    </View>
                  )}
                  style={styles.webview}
                />
                {!checkoutLoaded ? (
                  <View style={styles.webviewOverlay}>
                    <ActivityIndicator color="#087B57" />
                    <Text style={styles.webviewOverlayText}>Đang kết nối đến SePay...</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>Không mở được QR trong app</Text>
              <Text style={styles.warningText}>Trang thanh toán hiện chưa tải được trong ứng dụng. Vui lòng thử lại sau ít giây.</Text>
            </View>
          )}

          {paymentQuery.isError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Không kiểm tra được trạng thái thanh toán</Text>
              <Text style={styles.errorText}>
                {paymentQuery.error instanceof Error ? paymentQuery.error.message : "Vui lòng thử lại sau."}
              </Text>
            </View>
          ) : null}

          <Text style={styles.footnote}>Nếu đã chuyển khoản xong, chờ vài giây rồi nhấn kiểm tra giao dịch.</Text>
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable style={styles.primaryButton} onPress={handleCheckPayment}>
            {checkingPayment ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Kiểm tra giao dịch</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function parseCheckoutFields(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string | number>;
    }
  } catch {
    return {};
  }
  return {};
}

function parseWebViewMessage(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as
        | { type: "height"; height: number }
        | { type: "status"; status: string };
    }
  } catch {
    return null;
  }
  return null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCheckoutBridgeScript(receiverNameToHide?: string | null) {
  const targetNameJson = JSON.stringify(receiverNameToHide || "");

  return `
    (function() {
      function post(payload) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }
      function normalizeText(value) {
        return String(value || "")
          .toLowerCase()
          .replace(/\\s+/g, " ")
          .trim();
      }
      function sendHeight() {
        var body = document.body;
        var doc = document.documentElement;
        var height = Math.max(
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0,
          doc ? doc.clientHeight : 0,
          doc ? doc.scrollHeight : 0,
          doc ? doc.offsetHeight : 0
        );
        post({ type: "height", height: Math.min(height, ${INITIAL_CHECKOUT_HEIGHT}) });
      }
      function sendStatus() {
        var text = ((document.body && document.body.innerText) || "").toLowerCase();
        if (text.indexOf("thanh toán thành công") !== -1 || text.indexOf("thanh toan thanh cong") !== -1) {
          post({ type: "status", status: "paid" });
        }
      }
      function hideReceiverNameBlock() {
        var target = normalizeText(${targetNameJson});
        if (!target || !document || !document.body) {
          return false;
        }
        var elements = document.body.querySelectorAll("*");
        for (var i = 0; i < elements.length; i += 1) {
          var element = elements[i];
          var text = normalizeText(element.textContent);
          if (!text || text !== target) {
            continue;
          }
          var candidate = element;
          while (
            candidate.parentElement &&
            candidate.parentElement !== document.body &&
            candidate.parentElement.children.length === 1
          ) {
            candidate = candidate.parentElement;
          }
          candidate.style.display = "none";
          return true;
        }
        return false;
      }
      function sync() {
        hideReceiverNameBlock();
        sendHeight();
        sendStatus();
      }
      sync();
      setTimeout(sync, 250);
      setTimeout(sync, 900);
      setTimeout(sync, 1800);
      if (typeof MutationObserver === "function" && document && document.body) {
        var observer = new MutationObserver(function() {
          sync();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        setTimeout(function() {
          observer.disconnect();
        }, 5000);
      }
      true;
    })();
  `;
}

function buildCheckoutHtmlDocument(actionUrl: string, fields: Record<string, string | number>) {
  if (!actionUrl || Object.keys(fields).length === 0) {
    return "";
  }

  const formFieldsHtml = Object.entries(fields)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtmlAttribute(key)}" value="${escapeHtmlAttribute(String(value))}" />`
    )
    .join("");

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <title>ObiSpot Checkout</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #f7f9fc;
        color: #1d324a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .card {
        width: 100%;
        max-width: 320px;
        background: #ffffff;
        border: 1px solid #dfe7f2;
        border-radius: 16px;
        padding: 20px;
        text-align: center;
        box-sizing: border-box;
      }
      .spinner {
        width: 28px;
        height: 28px;
        margin: 0 auto 14px;
        border-radius: 999px;
        border: 3px solid #d5e2f0;
        border-top-color: #087b57;
        animation: spin 0.9s linear infinite;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        margin: 0 0 6px;
      }
      .hint {
        font-size: 13px;
        line-height: 1.5;
        color: #607287;
        margin: 0;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <div class="spinner"></div>
        <p class="title">Đang chuyển đến SePay</p>
        <p class="hint">Trang thanh toán sẽ tự mở trong giây lát.</p>
      </div>
    </div>
    <form id="checkout-form" action="${escapeHtmlAttribute(actionUrl)}" method="post">
      ${formFieldsHtml}
    </form>
    <script>
      (function() {
        var form = document.getElementById("checkout-form");
        if (form) {
          form.submit();
        }
      })();
    </script>
  </body>
</html>`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function extractQrAccountName(qrUrl: string) {
  if (!qrUrl) {
    return "";
  }

  try {
    const url = new URL(qrUrl);
    return (url.searchParams.get("accountName") || "").trim();
  } catch {
    return "";
  }
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    Number.isFinite(value) ? value : 0
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "Đang cập nhật";
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function getStatusMeta(status: "awaiting" | "paid" | "expired" | "refunded") {
  if (status === "paid") {
    return { label: "Đã thanh toán", color: "#087B57", background: "#DDF9EE" };
  }
  if (status === "expired") {
    return { label: "Hết hạn", color: "#B86800", background: "#FFF1DA" };
  }
  if (status === "refunded") {
    return { label: "Đã hoàn tiền", color: "#2A6EDB", background: "#E8F0FF" };
  }
  return { label: "Chờ thanh toán", color: "#6C7B90", background: "#ECF1F8" };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F2F5FA" },
  screen: { flex: 1 },
  container: { padding: 16, gap: 12 },
  header: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DFE7F2"
  },
  headerCopy: { flex: 1, gap: 4 },
  title: { fontSize: 28, fontWeight: "800", color: "#1A2B3F", lineHeight: 34 },
  subtitle: { color: "#5B6574", lineHeight: 20, fontSize: 14 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DFE7F2",
    padding: 14,
    gap: 10
  },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  statusCopy: { flex: 1, gap: 4 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: "#6B7D94", letterSpacing: 0.4, textTransform: "uppercase" },
  orderCode: { color: "#44566D", fontWeight: "800" },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusBadgeText: { fontSize: 12, fontWeight: "700" },
  amount: { fontSize: 26, fontWeight: "900", color: "#087B57" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  infoLabel: { flex: 1, color: "#607287" },
  infoValue: { flex: 1, color: "#1D324A", fontWeight: "700", textAlign: "right" },
  checkoutSection: { marginTop: -2 },
  webviewFrame: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "transparent",
    position: "relative"
  },
  webview: { flex: 1, backgroundColor: "transparent" },
  webviewLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#F7F9FC"
  },
  webviewLoadingText: { color: "#5B6574", fontWeight: "700" },
  webviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(247,249,252,0.92)"
  },
  webviewOverlayText: { color: "#5B6574", fontWeight: "700" },
  warningBox: {
    borderWidth: 1,
    borderColor: "#F2D6A8",
    backgroundColor: "#FFF3E0",
    borderRadius: 12,
    padding: 12,
    gap: 6
  },
  warningTitle: { color: "#9A5700", fontWeight: "800" },
  warningText: { color: "#7A5B2B", lineHeight: 20 },
  errorBox: {
    borderWidth: 1,
    borderColor: "#F0CACA",
    backgroundColor: "#FFF5F5",
    borderRadius: 12,
    padding: 12,
    gap: 6
  },
  errorTitle: { color: "#9B2C2C", fontWeight: "800" },
  errorText: { color: "#5B6574", lineHeight: 20 },
  footnote: { color: "#607287", lineHeight: 20, fontSize: 13, paddingHorizontal: 2 },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "#F2F5FA",
    borderTopWidth: 1,
    borderTopColor: "#E7EDF5"
  },
  primaryButton: {
    backgroundColor: "#087B57",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800" }
});
