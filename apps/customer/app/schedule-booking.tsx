import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiRequestError, createBookingApi, getSlotsApi } from "../src/lib/api";
import { useAuth } from "../src/store/auth";

export default function ScheduleBookingScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ venueId?: string; venueName?: string; venueAddress?: string }>();
  const venueId = params.venueId || "";
  const [selectedDate, setSelectedDate] = useState(getDateOffset(0));
  const [selectedSlotId, setSelectedSlotId] = useState("");

  const dateOptions = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, i) => {
        const d = getDateOffset(i);
        return { value: d, label: d.slice(8, 10) };
      }),
    []
  );

  const slotsQuery = useQuery({
    queryKey: ["slots", selectedDate, venueId],
    enabled: !!venueId,
    queryFn: () => getSlotsApi(selectedDate, venueId)
  });

  const createMutation = useMutation({
    mutationFn: (slotId: string) => {
      if (!token) {
        throw new Error("Thiếu token đăng nhập");
      }
      return createBookingApi(token, slotId, "Đặt từ màn đặt lịch trực quan");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["slots"] });
      queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      router.replace({
        pathname: "/booking-success",
        params: {
          bookingId: data.id,
          venueName: params.venueName || "Sân",
          selectedDate,
          slotId: data.slotId
        }
      });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === "BOOKING_CONFLICT") {
        Alert.alert("Slot đã có người đặt", "Vui lòng chọn khung giờ khác.");
        return;
      }
      Alert.alert("Lỗi", error instanceof Error ? error.message : "Không thể tạo booking.");
    }
  });

  const selectedSlot = (slotsQuery.data?.items || []).find((item) => item.id === selectedSlotId);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Đặt lịch trực quan</Text>
          <Text>ⓘ</Text>
        </View>

        <Text style={styles.dateTitle}>{selectedDate.split("-").reverse().join("/")}</Text>
        <View style={styles.dateRow}>
          {dateOptions.map((item) => {
            const active = selectedDate === item.value;
            return (
              <Pressable
                key={item.value}
                style={[styles.dateCell, active && styles.dateCellActive]}
                onPress={() => {
                  setSelectedDate(item.value);
                  setSelectedSlotId("");
                }}
              >
                <Text style={[styles.dateCellText, active && styles.dateCellTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <Text style={styles.legendText}>○ Trống</Text>
          <Text style={styles.legendText}>● Đã đặt</Text>
          <Text style={styles.legendText}>◆ Khóa</Text>
        </View>

        <View style={styles.slotGrid}>
          {(slotsQuery.data?.items || []).map((slot) => {
            const active = selectedSlotId === slot.id;
            return (
              <Pressable key={slot.id} style={[styles.slotItem, active && styles.slotItemActive]} onPress={() => setSelectedSlotId(slot.id)}>
                <Text style={[styles.slotTime, active && styles.slotTimeActive]}>
                  {new Date(slot.startTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                </Text>
                <Text style={[styles.slotField, active && styles.slotTimeActive]}>{slot.fieldName}</Text>
              </Pressable>
            );
          })}
        </View>

        {!!selectedSlot && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>{params.venueName}</Text>
            <Text style={styles.summaryText}>
              {selectedSlot.fieldName} • {new Date(selectedSlot.startTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} -{" "}
              {new Date(selectedSlot.endTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
            </Text>
            <Text style={styles.summaryPrice}>
              {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(selectedSlot.pricePerSlot)}
            </Text>
          </View>
        )}

        <Pressable
          style={[styles.nextButton, (!selectedSlotId || createMutation.isPending) && { opacity: 0.6 }]}
          disabled={!selectedSlotId || createMutation.isPending}
          onPress={() => createMutation.mutate(selectedSlotId)}
        >
          <Text style={styles.nextButtonText}>{createMutation.isPending ? "Đang xử lý..." : "TIẾP THEO"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function getDateOffset(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F7FB" },
  container: { padding: 14, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { fontSize: 24, fontWeight: "700" },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#1A2B3F" },
  dateTitle: { textAlign: "center", fontSize: 26, fontWeight: "800", color: "#1A2B3F" },
  dateRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  dateCell: {
    width: 58,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#E7EDF6",
    alignItems: "center"
  },
  dateCellActive: { backgroundColor: "#13B274" },
  dateCellText: { fontWeight: "700", color: "#293D54" },
  dateCellTextActive: { color: "#fff" },
  legendRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 4 },
  legendText: { color: "#55657A", fontSize: 12 },
  slotGrid: {
    borderWidth: 1,
    borderColor: "#D5E0EE",
    borderRadius: 12,
    padding: 10,
    gap: 8
  },
  slotItem: {
    borderWidth: 1,
    borderColor: "#D5E0EE",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff"
  },
  slotItemActive: { borderColor: "#13B274", backgroundColor: "#E8FCF3" },
  slotTime: { color: "#41546D", fontWeight: "700" },
  slotField: { color: "#687A90", marginTop: 2 },
  slotTimeActive: { color: "#0C8F60" },
  summaryCard: {
    borderWidth: 1,
    borderColor: "#D7E3F1",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff"
  },
  summaryTitle: { fontSize: 16, fontWeight: "800", color: "#1A2B3F" },
  summaryText: { color: "#5A6B80", marginTop: 4 },
  summaryPrice: { marginTop: 6, color: "#0D9B67", fontSize: 22, fontWeight: "900" },
  nextButton: {
    marginTop: 10,
    backgroundColor: "#087B57",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center"
  },
  nextButtonText: { color: "#fff", fontWeight: "900", letterSpacing: 1 }
});
