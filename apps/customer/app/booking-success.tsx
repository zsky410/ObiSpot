import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function BookingSuccessScreen() {
  const params = useLocalSearchParams<{ bookingId?: string; venueName?: string; selectedDate?: string }>();
  const bookingCode = (params.bookingId || "SP-20240430-01").slice(0, 12).toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>✓</Text>
        </View>
        <Text style={styles.title}>Đặt sân thành công!</Text>
        <Text style={styles.subtitle}>Đơn đặt sân của bạn đã được xác nhận. Thông tin chi tiết bên dưới.</Text>

        <View style={styles.infoBox}>
          <Row label="Mã đơn hàng" value={bookingCode} />
          <Row label="Tên sân" value={params.venueName || "Sân 5 người A - Chảo Lửa"} />
          <Row label="Ngày đá" value={params.selectedDate || "30/04/2026"} />
          <Row label="Tổng tiền" value="75.000 đ" highlight />
        </View>

        <View style={styles.noteBox}>
          <Text style={styles.note}>ⓘ Vui lòng đến trước 15 phút để chuẩn bị và làm thủ tục nhận sân.</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.replace("/(tabs)/my-bookings")}>
          <Text style={styles.primaryBtnText}>Xem đơn của tôi</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)/home")}>
          <Text style={styles.secondaryBtnText}>Về trang chủ</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.highlightValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F4F6FB" },
  container: { flex: 1, padding: 20, justifyContent: "center", gap: 14 },
  iconWrap: {
    alignSelf: "center",
    width: 94,
    height: 94,
    borderRadius: 999,
    backgroundColor: "#CFF4E4",
    alignItems: "center",
    justifyContent: "center"
  },
  icon: { fontSize: 38, color: "#067E57", fontWeight: "700" },
  title: { textAlign: "center", fontSize: 34, fontWeight: "800", color: "#1B2D42" },
  subtitle: { textAlign: "center", color: "#5D6D82" },
  infoBox: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#D9E2EF", padding: 12, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  rowLabel: { color: "#64778E" },
  rowValue: { color: "#1E324A", fontWeight: "700", flexShrink: 1, textAlign: "right" },
  highlightValue: { color: "#098F62", fontSize: 22, fontWeight: "900" },
  noteBox: { backgroundColor: "#EFF6F2", borderRadius: 10, padding: 10 },
  note: { color: "#5E6F82" },
  primaryBtn: { backgroundColor: "#087B57", borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "800" },
  secondaryBtn: { borderWidth: 1, borderColor: "#D6DEE9", borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: { color: "#6A7A90", fontWeight: "700" }
});
