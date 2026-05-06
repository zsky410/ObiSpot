import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImagePlaceholder } from "../src/components/ImagePlaceholder";
import { pitchImageByKey } from "../src/lib/pitchImages";
import { ApiRequestError, getMyBookingsApi, requestBookingCancelApi } from "../src/lib/api";
import { useAuth } from "../src/store/auth";

export default function BookingDetailScreen() {
  const queryClient = useQueryClient();
  const { token, bootstrapped, getValidAccessToken, user } = useAuth();
  const params = useLocalSearchParams<{ bookingId?: string }>();

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
  const cancelMutation = useMutation({
    mutationFn: async () => {
      const accessToken = await getValidAccessToken();
      if (!accessToken || !booking?.id) {
        throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      return requestBookingCancelApi(accessToken, booking.id);
    },
    onSuccess: async () => {
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
    booking.cancelRequest.status !== "pending";

  function handleCancelRequest() {
    if (!canRequestCancel) {
      return;
    }
    Alert.alert(
      "Yêu cầu hủy đơn",
      "Yêu cầu hủy sẽ được gửi tới admin để xác nhận. Bạn có muốn tiếp tục không?",
      [
        { text: "Để sau", style: "cancel" },
        { text: "Gửi yêu cầu", style: "destructive", onPress: () => cancelMutation.mutate() }
      ]
    );
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
          <Row
            label={`Giá thuê sân (${formatDurationLabel(booking?.slot.startTime, booking?.slot.endTime)})`}
            value={formatPrice(booking?.slot.pricePerSlot)}
          />
          <Row label="Dịch vụ thêm" value="0 đ" />
          <Row label="Tổng cộng" value={formatPrice(booking?.slot.pricePerSlot)} total />
          <Text style={styles.policy}>ⓘ Thanh toán trực tiếp tại sân sau khi kết thúc trận đấu.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Chính sách hủy sân</Text>
          <Text style={styles.rule}>• Hủy trước 24h: Miễn phí.</Text>
          <Text style={styles.rule}>• Hủy trong vòng 24h: Có thể bị phạt phí quản lý.</Text>
          <Text style={styles.rule}>• Liên hệ trực tiếp chủ sân nếu có thay đổi gấp.</Text>
          {booking?.cancelRequest.status === "pending" ? (
            <View style={styles.cancelRequestBox}>
              <Text style={styles.cancelRequestTitle}>Yêu cầu hủy đang chờ admin xác nhận</Text>
              <Text style={styles.cancelRequestText}>
                {booking.cancelRequest.requestedAt
                  ? `Đã gửi lúc ${formatDateTime(booking.cancelRequest.requestedAt)}.`
                  : "Yêu cầu đã được gửi."}
              </Text>
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
    </SafeAreaView>
  );
}

function getStatusMeta(
  booking?:
    | {
        status: "pending" | "confirmed" | "cancelled";
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
    description: "Chủ sân đang kiểm tra lịch trống.",
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
  cancelBtnTextDisabled: { color: "#8B98A8" }
});
