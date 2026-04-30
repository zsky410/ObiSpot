import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MyBooking, getMyBookingsApi } from "../../src/lib/api";
import { ImagePlaceholder } from "../../src/components/ImagePlaceholder";
import { TabHeaderLogo } from "../../src/components/TabHeaderLogo";
import { useAuth } from "../../src/store/auth";

export default function MyBookingsScreen() {
  const { token } = useAuth();
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "cancelled">("all");

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

  const filteredData = useMemo(() => {
    const items = bookingsQuery.data?.items || [];
    if (statusFilter === "all") {
      return items;
    }
    return items.filter((item) => item.status === statusFilter);
  }, [bookingsQuery.data?.items, statusFilter]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TabHeaderLogo />
          <Ionicons name="person-circle-outline" size={24} color="#6C7A71" />
        </View>
        <Text style={styles.title}>Lịch đặt</Text>
        <Text style={styles.subTitle}>Quản lý các lượt thuê sân của bạn</Text>

        <View style={styles.rowWrap}>
          {[
            { key: "pending", label: "Đang chờ" },
            { key: "confirmed", label: "Đã nhận" },
            { key: "cancelled", label: "Đã hủy" },
            { key: "all", label: "Tất cả" }
          ].map((item) => {
            const isActive = statusFilter === item.key;
            return (
              <Pressable
                key={item.key}
                style={[styles.pill, isActive && styles.pillActive]}
                onPress={() => setStatusFilter(item.key as typeof statusFilter)}
              >
                <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {bookingsQuery.isLoading && (
          <View style={{ paddingVertical: 20 }}>
            <ActivityIndicator color="#087B57" />
          </View>
        )}

        {!bookingsQuery.isLoading && filteredData.length === 0 && (
          <Text style={styles.emptyText}>Chưa có booking phù hợp với bộ lọc.</Text>
        )}

        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
          renderItem={({ item }) => <BookingItem item={item} />}
        />
      </View>
    </SafeAreaView>
  );
}

function BookingItem({ item }: { item: MyBooking }) {
  const statusMap = {
    pending: { label: "Đang chờ xác nhận", color: "#6C7B90", bg: "#ECF1F8" },
    confirmed: { label: "Đã nhận sân", color: "#087B57", bg: "#DDF9EE" },
    cancelled: { label: "Đã hủy", color: "#BA1A1A", bg: "#FFE8E8" }
  };
  const status = statusMap[item.status];
  return (
    <Pressable style={styles.card} onPress={() => router.push({ pathname: "/booking-detail", params: { bookingId: item.id } })}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={[styles.badge, { backgroundColor: status.bg, alignSelf: "flex-start" }]}>
            <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={styles.cardTitle}>{item.slot.fieldName || "Sân 5 người A - Chảo Lửa"}</Text>
          <Text style={styles.metaText}>📍 Quận Tân Bình, TP.HCM</Text>
        </View>
        <View style={styles.thumb}>
          <ImagePlaceholder
            height={56}
            label="Ảnh sân"
            imageUrl={`https://picsum.photos/seed/booking-${item.id}/800/500`}
          />
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.metaText}>Thời gian</Text>
          <Text style={styles.timeText}>
            {item.slot.startTime
              ? new Date(item.slot.startTime).toLocaleString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "2-digit"
                })
              : "20:00, 15/10"}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeText, { color: status.color }]}>{item.status === "pending" ? "Hủy đặt" : item.status === "confirmed" ? "Chỉ đường" : "Đặt lại"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F2F5FA" },
  container: { flex: 1, padding: 16, gap: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 34, fontWeight: "800", color: "#1A2B3F" },
  subTitle: { color: "#5B6574", marginBottom: 4 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6, backgroundColor: "#EAEFF6", padding: 6, borderRadius: 10 },
  pill: {
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "transparent"
  },
  pillActive: { backgroundColor: "#fff" },
  pillText: { color: "#5E6F83", fontSize: 12, fontWeight: "700" },
  pillTextActive: { color: "#1F3248" },
  emptyText: { color: "#5B6574", marginTop: 10 },
  card: {
    borderColor: "#DFE7F2",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#fff",
    gap: 8
  },
  cardTitle: { fontSize: 20, fontWeight: "800", color: "#0B1C30", flex: 1 },
  metaText: { color: "#5B6574" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  timeText: { color: "#21364E", fontWeight: "800", marginTop: 3 },
  thumb: { width: 70 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: "700" }
});
