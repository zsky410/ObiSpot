import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImagePlaceholder } from "../src/components/ImagePlaceholder";
import { getMyBookingsApi } from "../src/lib/api";
import { useAuth } from "../src/store/auth";

export default function BookingDetailScreen() {
  const { token } = useAuth();
  const params = useLocalSearchParams<{ bookingId?: string }>();

  const bookingsQuery = useQuery({
    queryKey: ["my-bookings"],
    queryFn: () => {
      if (!token) {
        throw new Error("Thiếu token");
      }
      return getMyBookingsApi(token);
    },
    enabled: !!token
  });

  const booking = (bookingsQuery.data?.items || []).find((item) => item.id === params.bookingId) || bookingsQuery.data?.items?.[0];

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

        <View style={styles.statusBox}>
          <Text style={styles.statusTitle}>MÃ ĐƠN #{(booking?.id || "SPRO-0842").slice(0, 8).toUpperCase()}</Text>
          <Text style={styles.statusPending}>🔵 Đang chờ xác nhận</Text>
          <Text style={styles.statusSub}>Chủ sân đang kiểm tra lịch trống</Text>
        </View>

        <View style={styles.card}>
          <ImagePlaceholder
            height={120}
            label="Ảnh sân"
            imageUrl={`https://picsum.photos/seed/booking-detail-${params.bookingId || "default"}/1200/600`}
          />
          <Text style={styles.pitchName}>{booking?.slot.fieldName || "Sân Bóng Chảo Lửa"}</Text>
          <Text style={styles.meta}>📍 30 Phan Thúc Duyện, Phường 4, Tân Bình, TP.HCM</Text>
          <View style={styles.metaGrid}>
            <MetaItem label="Ngày đá" value="Thứ 6, 27/10" />
            <MetaItem label="Khung giờ" value="18:00 - 19:30" />
            <MetaItem label="Loại sân" value="Sân 7 người" />
            <MetaItem label="Tên sân" value="Sân số 3" />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thanh toán</Text>
          <Row label="Giá thuê sân (1.5h)" value="500.000 đ" />
          <Row label="Dịch vụ thêm (Nước, Bóng)" value="50.000 đ" />
          <Row label="Tổng cộng" value="550.000 đ" total />
          <Text style={styles.policy}>ⓘ Thanh toán trực tiếp tại sân sau khi kết thúc trận đấu.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Chính sách hủy sân</Text>
          <Text style={styles.rule}>• Hủy trước 24h: Miễn phí.</Text>
          <Text style={styles.rule}>• Hủy trong vòng 24h: Có thể bị phạt phí quản lý.</Text>
          <Text style={styles.rule}>• Liên hệ trực tiếp chủ sân nếu có thay đổi gấp.</Text>
        </View>

        <Pressable style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>YÊU CẦU HỦY ĐƠN</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
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
  cancelBtn: { borderWidth: 1, borderColor: "#E9B4B4", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelBtnText: { color: "#D24545", fontWeight: "800" }
});
