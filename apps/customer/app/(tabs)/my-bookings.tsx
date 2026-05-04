import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ApiRequestError, MyBooking, getMyBookingsApi } from "../../src/lib/api";
import { pitchImageByKey } from "../../src/lib/pitchImages";
import { ImagePlaceholder } from "../../src/components/ImagePlaceholder";
import { TabHeaderLogo } from "../../src/components/TabHeaderLogo";
import { useAuth } from "../../src/store/auth";

export default function MyBookingsScreen() {
  const queryClient = useQueryClient();
  const { token, bootstrapped, getValidAccessToken, user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "cancelled">("all");

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

  useFocusEffect(
    useCallback(() => {
      if (bootstrapped && token) {
        queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      }
    }, [bootstrapped, token, queryClient])
  );

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

        {bookingsQuery.isError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Không tải được lịch đặt</Text>
            <Text style={styles.errorText}>
              {bookingsQuery.error instanceof ApiRequestError
                ? bookingsQuery.error.message
                : bookingsQuery.error instanceof Error
                  ? bookingsQuery.error.message
                  : "Lỗi mạng hoặc phiên đăng nhập không còn hợp lệ."}
            </Text>
            <Pressable style={styles.retryBtn} onPress={() => bookingsQuery.refetch()}>
              <Text style={styles.retryBtnText}>Thử lại</Text>
            </Pressable>
          </View>
        )}

        {!bookingsQuery.isLoading && !bookingsQuery.isError && filteredData.length === 0 && (
          <Text style={styles.emptyText}>Chưa có booking phù hợp với bộ lọc.</Text>
        )}

        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
          refreshing={bookingsQuery.isRefetching}
          onRefresh={() => bookingsQuery.refetch()}
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
  const fieldTitle = item.slot.fieldName?.trim() || "—";
  const venueLine = [item.venue.name?.trim(), item.venue.address?.trim()].filter(Boolean).join(" · ");
  const thumbKey = item.venue.id || item.id;
  const notePreview = item.note?.trim()
    ? item.note.trim().length > 80
      ? `${item.note.trim().slice(0, 80)}…`
      : item.note.trim()
    : null;

  return (
    <Pressable style={styles.card} onPress={() => router.push({ pathname: "/booking-detail", params: { bookingId: item.id } })}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={[styles.badge, { backgroundColor: status.bg, alignSelf: "flex-start" }]}>
            <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={styles.orderId}>Mã đơn #{item.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={styles.cardTitle}>{fieldTitle}</Text>
          <Text style={styles.metaText}>{venueLine ? `📍 ${venueLine}` : "📍 —"}</Text>
          {notePreview ? (
            <Text style={styles.noteText} numberOfLines={2}>
              Ghi chú: {notePreview}
            </Text>
          ) : null}
        </View>
        <View style={styles.thumb}>
          <ImagePlaceholder height={56} source={pitchImageByKey(thumbKey)} />
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.metaText}>Khung giờ</Text>
          <Text style={styles.timeText}>{formatBookingTimeRange(item)}</Text>
          {item.createdAt ? (
            <Text style={styles.createdText}>Đặt lúc {formatCreatedAt(item.createdAt)}</Text>
          ) : null}
        </View>
        <View style={styles.priceCol}>
          <Text style={styles.priceLabel}>Giá slot</Text>
          <Text style={styles.priceValue}>{formatVnd(item.slot.pricePerSlot)}</Text>
          <Text style={styles.detailHint}>Chi tiết ›</Text>
        </View>
      </View>
    </Pressable>
  );
}

const VN_TZ = "Asia/Ho_Chi_Minh";

function formatBookingTimeRange(item: MyBooking) {
  if (!item.slot.startTime || !item.slot.endTime) {
    return "—";
  }
  const start = new Date(item.slot.startTime);
  const end = new Date(item.slot.endTime);
  const dateLabel = start.toLocaleDateString("vi-VN", { timeZone: VN_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  const startLabel = start.toLocaleTimeString("vi-VN", { timeZone: VN_TZ, hour: "2-digit", minute: "2-digit" });
  const endLabel = end.toLocaleTimeString("vi-VN", { timeZone: VN_TZ, hour: "2-digit", minute: "2-digit" });
  return `${startLabel} – ${endLabel}, ${dateLabel}`;
}

function formatCreatedAt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", {
    timeZone: VN_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatVnd(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
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
  errorBox: {
    borderWidth: 1,
    borderColor: "#F0CACA",
    backgroundColor: "#FFF5F5",
    borderRadius: 12,
    padding: 12,
    gap: 8
  },
  errorTitle: { fontWeight: "800", color: "#9B2C2C", fontSize: 15 },
  errorText: { color: "#5B6574", fontSize: 13 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#087B57",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10
  },
  retryBtnText: { color: "#fff", fontWeight: "700" },
  card: {
    borderColor: "#DFE7F2",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#fff",
    gap: 8
  },
  orderId: { fontSize: 11, fontWeight: "700", color: "#6B7D94", marginTop: 4, letterSpacing: 0.3 },
  cardTitle: { fontSize: 20, fontWeight: "800", color: "#0B1C30", flex: 1 },
  metaText: { color: "#5B6574" },
  noteText: { color: "#4A5A6E", fontSize: 12, marginTop: 4, fontStyle: "italic" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  timeText: { color: "#21364E", fontWeight: "800", marginTop: 3 },
  createdText: { color: "#8A98A9", fontSize: 11, marginTop: 4 },
  priceCol: { alignItems: "flex-end" },
  priceLabel: { fontSize: 10, color: "#8A98A9", fontWeight: "600" },
  priceValue: { fontSize: 15, fontWeight: "800", color: "#087B57", marginTop: 2 },
  detailHint: { fontSize: 11, color: "#6C7B90", marginTop: 4, fontWeight: "600" },
  thumb: { width: 70 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: "700" }
});
