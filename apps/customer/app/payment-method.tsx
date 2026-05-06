import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

export default function PaymentMethodScreen() {
  const insets = useSafeAreaInsets();
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
  const amount = Number(params.amountVnd || params.totalPrice || 0);
  const canContinue = Boolean(params.checkoutActionUrl || params.checkoutUrl);

  const nextParams = {
    orderId,
    bookingId: params.bookingId || "",
    venueId: params.venueId || "",
    venueName: params.venueName || "",
    selectedDate: params.selectedDate || "",
    totalPrice: params.totalPrice || "",
    amountVnd: params.amountVnd || "",
    checkoutUrl: params.checkoutUrl || "",
    checkoutActionUrl: params.checkoutActionUrl || "",
    checkoutFieldsJson: params.checkoutFieldsJson || "",
    qrUrl: params.qrUrl || "",
    invoiceNumber: params.invoiceNumber || "",
    expiresAt: params.expiresAt || "",
    paymentMethod: params.paymentMethod || ""
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: Math.max(insets.bottom, 16) + 96 }]}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color="#4D5E73" />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Thanh toán</Text>
              <Text style={styles.subtitle}>Chọn phương thức để giữ slot.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Thông tin đơn</Text>
            <Text style={styles.orderCode}>Mã đơn #{(params.invoiceNumber || orderId).slice(0, 18).toUpperCase()}</Text>
            <Text style={styles.venueName}>{params.venueName || "ObiSpot"}</Text>
            <InfoRow label="Ngày đá" value={formatDateLabel(params.selectedDate || "")} />
            <InfoRow label="Giữ chỗ đến" value={formatDeadline(params.expiresAt || "")} />
            <InfoRow label="Tổng thanh toán" value={formatPrice(amount)} highlight />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Phương thức thanh toán</Text>
            <Pressable
              style={[styles.optionCard, canContinue && styles.optionCardActive]}
              disabled={!canContinue}
              onPress={() => router.push({ pathname: "/payment-qr", params: nextParams })}
            >
              <View style={styles.optionIcon}>
                <Ionicons name="qr-code-outline" size={22} color="#087B57" />
              </View>
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>SePay QR chuyển khoản</Text>
                <Text style={styles.optionDescription}>
                  Mở trang thanh toán SePay ngay trong app để quét mã và chuyển khoản đúng số tiền.
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={22} color="#087B57" />
            </Pressable>
          </View>

          <Text style={styles.footnote}>Hủy trước 24h hoàn 100%. Hủy trong 24h trừ 30% sau khi admin duyệt.</Text>

          {!canContinue ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Chưa tạo được trang thanh toán</Text>
              <Text style={styles.errorText}>Vui lòng thử lại sau hoặc kiểm tra cấu hình SePay trên backend.</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            style={[styles.primaryButton, !canContinue && styles.primaryButtonDisabled]}
            disabled={!canContinue}
            onPress={() => router.push({ pathname: "/payment-qr", params: nextParams })}
          >
            <Text style={styles.primaryButtonText}>Tiếp tục thanh toán</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  highlight
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, highlight && styles.infoValueHighlight]}>{value}</Text>
    </View>
  );
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    Number.isFinite(value) ? value : 0
  );
}

function formatDateLabel(value: string) {
  if (!value) return "Đang cập nhật";
  const date = new Date(`${value}T00:00:00+07:00`);
  return date.toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatDeadline(value: string) {
  if (!value) return "Đang cập nhật";
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  });
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
  sectionLabel: { fontSize: 11, fontWeight: "700", color: "#6B7D94", letterSpacing: 0.4, textTransform: "uppercase" },
  orderCode: { color: "#44566D", fontWeight: "800" },
  venueName: { fontSize: 20, lineHeight: 26, fontWeight: "800", color: "#0B1C30" },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#1B2D42" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  infoLabel: { flex: 1, color: "#607287" },
  infoValue: { flex: 1, color: "#1D324A", fontWeight: "700", textAlign: "right" },
  infoValueHighlight: { color: "#087B57", fontSize: 22, fontWeight: "900" },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DFE7F2",
    backgroundColor: "#FFFFFF"
  },
  optionCardActive: { backgroundColor: "#F8FCFA", borderColor: "#BFDCCF" },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8F7F0"
  },
  optionBody: { flex: 1, gap: 4 },
  optionTitle: { fontSize: 16, fontWeight: "800", color: "#0B1C30" },
  optionDescription: { color: "#5B6574", lineHeight: 20 },
  footnote: { color: "#607287", lineHeight: 20, fontSize: 13, paddingHorizontal: 2 },
  errorBox: {
    borderWidth: 1,
    borderColor: "#F0CACA",
    backgroundColor: "#FFF5F5",
    borderRadius: 12,
    padding: 12,
    gap: 6
  },
  errorTitle: { color: "#9B2C2C", fontWeight: "800" },
  errorText: { color: "#5B6574" },
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
    paddingVertical: 15,
    alignItems: "center"
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 }
});
