import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImagePlaceholder } from "../src/components/ImagePlaceholder";
import { pitchImageByKey } from "../src/lib/pitchImages";
import { ApiRequestError, getMyBookingsApi, getRefundQuoteApi, requestBookingCancelApi, type RefundBankAccount } from "../src/lib/api";
import { useAuth } from "../src/store/auth";

export default function BookingDetailScreen() {
  const queryClient = useQueryClient();
  const { token, bootstrapped, getValidAccessToken, user } = useAuth();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [refundBankName, setRefundBankName] = useState("");
  const [refundAccountNumber, setRefundAccountNumber] = useState("");
  const [refundAccountHolderName, setRefundAccountHolderName] = useState(user?.fullName || "");
  const [refundQuotePreview, setRefundQuotePreview] = useState<{
    totalAmountVnd: number;
    feePercent: number;
    refundAmountVnd: number;
  } | null>(null);

  const bookingsQuery = useQuery({
    queryKey: ["my-bookings", user?.id ?? "_"],
    queryFn: async () => {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      return getMyBookingsApi(accessToken);
    },
    enabled: bootstrapped && !!token && !!user?.id
  });

  const booking = (bookingsQuery.data?.items || []).find((item) => item.id === params.bookingId) || bookingsQuery.data?.items?.[0];
  const statusMeta = getStatusMeta(booking);
  const heroImageKey = booking?.venue.id || params.bookingId || "booking";

  useEffect(() => {
    if (user?.fullName && !refundAccountHolderName.trim()) {
      setRefundAccountHolderName(user.fullName);
    }
  }, [refundAccountHolderName, user?.fullName]);

  useEffect(() => {
    const savedBankAccount = booking?.refundRequest?.bankAccount;
    if (!savedBankAccount) {
      return;
    }

    setRefundBankName((current) => current.trim() || savedBankAccount.bankName);
    setRefundAccountNumber((current) => current.trim() || savedBankAccount.accountNumber);
    setRefundAccountHolderName((current) => current.trim() || savedBankAccount.accountHolderName);
  }, [booking?.id, booking?.refundRequest?.bankAccount]);

  const cancelMutation = useMutation({
    mutationFn: async (payload: { refundBankAccount: RefundBankAccount }) => {
      const accessToken = await getValidAccessToken();
      if (!accessToken || !booking?.id) {
        throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      return requestBookingCancelApi(accessToken, booking.id, payload);
    },
    onSuccess: async () => {
      setCancelModalVisible(false);
      await queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      Alert.alert("Đã gửi yêu cầu", "Yêu cầu hủy sân đã được gửi tới admin để xác nhận.");
    },
    onError: (error) => {
      Alert.alert("Không thể gửi yêu cầu", error instanceof Error ? error.message : "Vui lòng thử lại sau.");
    }
  });
  const canRequestCancel =
    !!booking &&
    booking.status !== "cancelled" &&
    booking.cancelRequest.status !== "pending" &&
    booking.paymentStatus === "paid";

  async function handleCancelRequest() {
    if (!canRequestCancel) {
      return;
    }
    const accessToken = await getValidAccessToken();
    if (!accessToken || !booking?.id) {
      Alert.alert("Phiên hết hạn", "Vui lòng đăng nhập lại.");
      return;
    }
    let feeText = "Phí hủy: 0%";
    let refundText = "";
    let nextQuote: { totalAmountVnd: number; feePercent: number; refundAmountVnd: number } | null = null;
    try {
      const quote = await getRefundQuoteApi(accessToken, booking.id);
      nextQuote = quote.refundQuote;
      feeText = `Phí hủy: ${quote.refundQuote.feePercent}%`;
      refundText = `Hoàn dự kiến: ${formatPrice(quote.refundQuote.refundAmountVnd)} / ${formatPrice(quote.refundQuote.totalAmountVnd)}`;
    } catch {
      // keep default message
    }
    Alert.alert(
      "Yêu cầu hủy đơn",
      `Yêu cầu hủy sẽ được gửi tới admin để xác nhận.\n${feeText}\n${refundText}\nNếu đồng ý chính sách hoàn tiền, bạn sẽ nhập tài khoản nhận hoàn ở bước tiếp theo.`.trim(),
      [
        { text: "Để sau", style: "cancel" },
        {
          text: "Đồng ý, tiếp tục",
          onPress: () => {
            setRefundQuotePreview(nextQuote);
            setCancelModalVisible(true);
          }
        }
      ]
    );
  }

  function submitCancelRequest() {
    const bankName = refundBankName.trim();
    const accountNumber = normalizeAccountNumber(refundAccountNumber);
    const accountHolderName = refundAccountHolderName.trim();

    if (bankName.length < 2) {
      Alert.alert("Thiếu ngân hàng", "Vui lòng nhập tên ngân hàng nhận hoàn.");
      return;
    }

    if (!/^\d{6,30}$/.test(accountNumber)) {
      Alert.alert("Số tài khoản chưa hợp lệ", "Vui lòng nhập số tài khoản gồm 6-30 chữ số.");
      return;
    }

    if (accountHolderName.length < 2) {
      Alert.alert("Thiếu người thụ hưởng", "Vui lòng nhập tên người thụ hưởng.");
      return;
    }

    cancelMutation.mutate({
      refundBankAccount: {
        bankName,
        accountNumber,
        accountHolderName
      }
    });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>←</Text>
          </Pressable>
          <Text style={styles.title}>Chi tiết đặt sân</Text>
          <Text style={styles.more}>⋮</Text>
        </View>

        {bookingsQuery.isError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Không tải được chi tiết booking</Text>
            <Text style={styles.errorText}>
              {bookingsQuery.error instanceof ApiRequestError
                ? bookingsQuery.error.message
                : bookingsQuery.error instanceof Error
                  ? bookingsQuery.error.message
                  : "Lỗi mạng hoặc phiên đăng nhập không còn hợp lệ."}
            </Text>
          </View>
        )}

        <View style={styles.statusBox}>
          <Text style={styles.statusTitle}>MÃ ĐƠN #{(booking?.id || "SPRO-0842").slice(0, 8).toUpperCase()}</Text>
          <Text style={[styles.statusPending, { color: statusMeta.color }]}>
            {statusMeta.icon} {statusMeta.label}
          </Text>
          <Text style={styles.statusSub}>{statusMeta.description}</Text>
        </View>

        <View style={styles.card}>
          <ImagePlaceholder height={120} source={pitchImageByKey(heroImageKey)} />
          <Text style={styles.pitchName}>{booking?.slot.fieldName || "Sân Bóng Chảo Lửa"}</Text>
          <Text style={styles.meta}>📍 {booking?.venue.address || "Địa chỉ đang cập nhật"}</Text>
          <View style={styles.metaGrid}>
            <MetaItem label="Ngày đá" value={formatBookingDate(booking?.slot.startTime)} />
            <MetaItem label="Khung giờ" value={formatBookingHourRange(booking?.slot.startTime, booking?.slot.endTime)} />
            <MetaItem label="Chi nhánh" value={booking?.venue.name || "Đang cập nhật"} />
            <MetaItem label="Tên sân" value={booking?.slot.fieldName || "Đang cập nhật"} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thanh toán</Text>
          <Row label="Trạng thái thanh toán" value={paymentStatusLabel(booking?.paymentStatus)} />
          {booking?.paymentExpiresAt && booking.paymentStatus === "awaiting" ? (
            <Row label="Hạn thanh toán" value={formatDateTime(booking.paymentExpiresAt)} />
          ) : null}
          <Row
            label={`Giá thuê sân (${formatDurationLabel(booking?.slot.startTime, booking?.slot.endTime)})`}
            value={formatPrice(booking?.slot.pricePerSlot)}
          />
          <Row label="Dịch vụ thêm" value="0 đ" />
          <Row label="Tổng cộng" value={formatPrice(booking?.slot.pricePerSlot)} total />
          <Text style={styles.policy}>{paymentPolicyText(booking?.paymentStatus, booking?.paymentExpiresAt)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Chính sách hủy sân</Text>
          <Text style={styles.rule}>• Hủy trước 24h: gửi yêu cầu tới admin và hoàn thủ công 100%.</Text>
          <Text style={styles.rule}>• Hủy trong vòng 24h: trừ 30% giá trị thanh toán, phần còn lại hoàn thủ công sau khi admin duyệt.</Text>
          <Text style={styles.rule}>• Nếu đơn chưa thanh toán hoặc đã hết hạn, slot sẽ tự nhả theo thời gian giữ chỗ.</Text>
          {booking?.cancelRequest.status === "pending" ? (
            <View style={styles.cancelRequestBox}>
              <Text style={styles.cancelRequestTitle}>Yêu cầu hủy đang chờ admin xác nhận</Text>
              <Text style={styles.cancelRequestText}>
                {booking.cancelRequest.requestedAt
                  ? `Đã gửi lúc ${formatDateTime(booking.cancelRequest.requestedAt)}.`
                  : "Yêu cầu đã được gửi."}
              </Text>
              {booking.refundRequest?.bankAccount ? (
                <>
                  <Text style={styles.cancelRequestText}>Ngân hàng nhận hoàn: {booking.refundRequest.bankAccount.bankName}</Text>
                  <Text style={styles.cancelRequestText}>STK: {formatBankAccountNumber(booking.refundRequest.bankAccount.accountNumber)}</Text>
                  <Text style={styles.cancelRequestText}>Người thụ hưởng: {booking.refundRequest.bankAccount.accountHolderName}</Text>
                </>
              ) : null}
            </View>
          ) : null}
        </View>

        <Pressable
          style={[
            styles.cancelBtn,
            (!canRequestCancel || cancelMutation.isPending) && styles.cancelBtnDisabled
          ]}
          disabled={!canRequestCancel || cancelMutation.isPending}
          onPress={handleCancelRequest}
        >
          <Text style={[styles.cancelBtnText, (!canRequestCancel || cancelMutation.isPending) && styles.cancelBtnTextDisabled]}>
            {booking?.status === "cancelled"
              ? "ĐƠN ĐÃ HỦY"
              : booking?.cancelRequest.status === "pending"
                ? "ĐÃ GỬI YÊU CẦU HỦY"
                : cancelMutation.isPending
                  ? "ĐANG GỬI YÊU CẦU..."
                  : "YÊU CẦU HỦY ĐƠN"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={cancelModalVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => {
          if (!cancelMutation.isPending) {
            setCancelModalVisible(false);
          }
        }}
      >
        <SafeAreaView style={styles.modalSafe}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Thông tin nhận hoàn</Text>
                <Text style={styles.modalSubtitle}>
                  Admin sẽ dùng đúng thông tin dưới đây để kiểm tra và hoàn tiền thủ công cho bạn.
                </Text>
              </View>

              <View style={styles.modalCard}>
                <Text style={styles.modalSectionTitle}>Tóm tắt hoàn tiền</Text>
                <Row label="Phí hủy" value={`${refundQuotePreview?.feePercent ?? 0}%`} />
                <Row label="Hoàn dự kiến" value={formatPrice(refundQuotePreview?.refundAmountVnd)} />
                <Row label="Tổng thanh toán" value={formatPrice(refundQuotePreview?.totalAmountVnd)} />
                <Text style={styles.modalHint}>
                  Số tiền hoàn thực tế sẽ do admin kiểm tra và xác nhận theo chính sách hoàn tiền.
                </Text>
              </View>

              <View style={styles.modalCard}>
                <Text style={styles.modalSectionTitle}>Tài khoản người thụ hưởng</Text>
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Ngân hàng</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Ví dụ: Vietcombank"
                    placeholderTextColor="#8A96A8"
                    value={refundBankName}
                    onChangeText={setRefundBankName}
                    editable={!cancelMutation.isPending}
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Số tài khoản</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Nhập số tài khoản nhận hoàn"
                    placeholderTextColor="#8A96A8"
                    value={refundAccountNumber}
                    onChangeText={setRefundAccountNumber}
                    keyboardType="number-pad"
                    editable={!cancelMutation.isPending}
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Người thụ hưởng</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Tên chủ tài khoản"
                    placeholderTextColor="#8A96A8"
                    value={refundAccountHolderName}
                    onChangeText={setRefundAccountHolderName}
                    editable={!cancelMutation.isPending}
                  />
                </View>
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.modalSecondaryBtn, cancelMutation.isPending && styles.cancelBtnDisabled]}
                  onPress={() => setCancelModalVisible(false)}
                  disabled={cancelMutation.isPending}
                >
                  <Text style={styles.modalSecondaryBtnText}>Để sau</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalPrimaryBtn, cancelMutation.isPending && styles.modalPrimaryBtnDisabled]}
                  onPress={submitCancelRequest}
                  disabled={cancelMutation.isPending}
                >
                  <Text style={styles.modalPrimaryBtnText}>
                    {cancelMutation.isPending ? "ĐANG GỬI..." : "Gửi admin duyệt"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function getStatusMeta(
  booking?:
    | {
        status: "pending" | "confirmed" | "cancelled";
        paymentStatus?: "awaiting" | "paid" | "expired" | "refunded";
        cancelRequest: { status: "pending" | "approved" | "rejected" | null };
      }
    | undefined
) {
  if (booking?.cancelRequest.status === "pending") {
    return {
      icon: "🟠",
      label: "Đang chờ duyệt hủy",
      description: "Yêu cầu hủy đã được gửi tới admin và đang chờ xác nhận.",
      color: "#B86800"
    };
  }
  const status = booking?.status;
  if (status === "confirmed") {
    return {
      icon: "🟢",
      label: "Đã xác nhận",
      description: "Đơn đã được chủ sân xác nhận.",
      color: "#087B57"
    };
  }
  if (status === "cancelled") {
    return {
      icon: "🔴",
      label: "Đã hủy",
      description: "Đơn đã bị hủy, slot được mở lại.",
      color: "#BA1A1A"
    };
  }
  return {
    icon: "🔵",
    label: "Đang chờ xác nhận",
    description:
      booking?.cancelRequest.status === "approved"
        ? "Đơn đã được duyệt hủy."
        : booking?.paymentStatus === "paid"
          ? "Thanh toán đã được ghi nhận, chủ sân đang kiểm tra và xác nhận lịch."
          : "Đơn đang được giữ chỗ và chờ hoàn tất thanh toán.",
    color: "#2A6EDB"
  };
}

function formatBookingDate(startTime?: string | null) {
  if (!startTime) return "Đang cập nhật";
  const date = new Date(startTime);
  return date.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatBookingHourRange(startTime?: string | null, endTime?: string | null) {
  if (!startTime || !endTime) return "Đang cập nhật";
  const start = new Date(startTime);
  const end = new Date(endTime);
  const startLabel = start.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const endLabel = end.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${startLabel} - ${endLabel}`;
}

function formatDurationLabel(startTime?: string | null, endTime?: string | null) {
  if (!startTime || !endTime) return "--";
  const minutes = Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
  const hours = Math.floor(minutes / 60);
  const remain = Math.round(minutes % 60);
  if (hours === 0) return `${remain} phút`;
  return remain === 0 ? `${hours}h` : `${hours}h${String(remain).padStart(2, "0")}`;
}

function formatPrice(value?: number) {
  const price = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(price);
}

function normalizeAccountNumber(value: string) {
  return value.replace(/\s+/g, "");
}

function formatBankAccountNumber(value: string) {
  const normalized = normalizeAccountNumber(value);
  return normalized.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function paymentStatusLabel(status?: "awaiting" | "paid" | "expired" | "refunded") {
  if (status === "paid") return "Đã thanh toán";
  if (status === "expired") return "Hết hạn";
  if (status === "refunded") return "Đã hoàn tiền";
  return "Chờ thanh toán";
}

function paymentPolicyText(status?: "awaiting" | "paid" | "expired" | "refunded", expiresAt?: string | null) {
  if (status === "paid") {
    return "ⓘ Tiền đã được ghi nhận qua SePay. Đơn đang chờ admin/chủ sân xác nhận lịch.";
  }
  if (status === "expired") {
    return "ⓘ Phiên thanh toán đã hết hạn và slot đã được nhả lại cho hệ thống.";
  }
  if (status === "refunded") {
    return "ⓘ Khoản thanh toán này đã được admin đánh dấu hoàn tiền thủ công.";
  }
  if (expiresAt) {
    return `ⓘ Vui lòng hoàn tất thanh toán trước ${formatDateTime(expiresAt)} để giữ slot.`;
  }
  return "ⓘ Đơn đang chờ thanh toán qua SePay trước khi chuyển sang bước xác nhận.";
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function Row({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, total && styles.rowTotal]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6FB" },
  container: { padding: 14, gap: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  back: { fontSize: 24, fontWeight: "700" },
  title: { fontSize: 28, fontWeight: "800", color: "#10A672" },
  more: { fontSize: 20, color: "#5F6D81" },
  errorBox: { backgroundColor: "#FFF5F5", borderRadius: 12, borderWidth: 1, borderColor: "#F0CACA", padding: 12, gap: 5 },
  errorTitle: { color: "#9B2C2C", fontWeight: "800" },
  errorText: { color: "#5B6574" },
  statusBox: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#D7E3F1", padding: 12, gap: 5 },
  statusTitle: { color: "#44566D", fontWeight: "800" },
  statusPending: { color: "#2A6EDB", fontWeight: "700" },
  statusSub: { color: "#627388" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#D7E3F1", padding: 12, gap: 8 },
  pitchName: { fontSize: 34, lineHeight: 36, fontWeight: "800", color: "#1B2D42" },
  meta: { color: "#57687D" },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaItem: { width: "48%", backgroundColor: "#F2F6FC", borderRadius: 10, padding: 10 },
  metaLabel: { color: "#6B7A8E", fontSize: 12 },
  metaValue: { color: "#1B2D42", fontWeight: "700", marginTop: 2 },
  sectionTitle: { fontSize: 28, fontWeight: "800", color: "#1B2D42" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { color: "#607287" },
  rowValue: { color: "#1D324A", fontWeight: "700" },
  rowTotal: { color: "#068F61", fontSize: 24, fontWeight: "900" },
  policy: { color: "#607287", marginTop: 2 },
  rule: { color: "#607287" },
  cancelRequestBox: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: "#FFF3E0",
    borderWidth: 1,
    borderColor: "#F2D6A8",
    padding: 10,
    gap: 4
  },
  cancelRequestTitle: { color: "#9A5700", fontWeight: "800" },
  cancelRequestText: { color: "#7A5B2B" },
  cancelBtn: { borderWidth: 1, borderColor: "#E9B4B4", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelBtnDisabled: { borderColor: "#D9E0EA", backgroundColor: "#F4F6FA" },
  cancelBtnText: { color: "#D24545", fontWeight: "800" },
  cancelBtnTextDisabled: { color: "#8B98A8" },
  modalSafe: { flex: 1, backgroundColor: "#F3F6FB" },
  modalKeyboard: { flex: 1 },
  modalContent: { padding: 16, gap: 12 },
  modalHeader: { gap: 6 },
  modalTitle: { fontSize: 28, fontWeight: "800", color: "#1B2D42" },
  modalSubtitle: { color: "#607287", lineHeight: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#D7E3F1", padding: 14, gap: 10 },
  modalSectionTitle: { fontSize: 20, fontWeight: "800", color: "#1B2D42" },
  modalHint: { color: "#607287", lineHeight: 19 },
  formGroup: { gap: 6 },
  inputLabel: { color: "#44566D", fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#D7E3F1",
    borderRadius: 12,
    backgroundColor: "#F9FBFE",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#1D324A"
  },
  modalActions: { flexDirection: "row", gap: 10 },
  modalSecondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D7E3F1",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff"
  },
  modalSecondaryBtnText: { color: "#607287", fontWeight: "800" },
  modalPrimaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#10A672"
  },
  modalPrimaryBtnDisabled: { backgroundColor: "#A9D7C8" },
  modalPrimaryBtnText: { color: "#fff", fontWeight: "800" }
});
