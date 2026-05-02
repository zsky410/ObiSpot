import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImagePlaceholder } from "../src/components/ImagePlaceholder";
import { ApiRequestError, createBookingApi, getSlotsApi } from "../src/lib/api";
import { useAuth } from "../src/store/auth";

export default function ScheduleBookingScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ venueId?: string; venueName?: string; venueAddress?: string }>();
  const venueId = params.venueId || "";
  const [selectedDate, setSelectedDate] = useState(getDateOffset(0));
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedCellKey, setSelectedCellKey] = useState("");

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
  const timelineTimes = useMemo(() => buildTimelineLabels(), []);

  const fieldRows = useMemo(() => {
    const uniq = Array.from(new Set((slotsQuery.data?.items || []).map((slot) => slot.fieldName))).filter(Boolean);
    if (uniq.length > 0) {
      return uniq;
    }
    return ["Sân A1", "Sân A2", "Sân A3", "Sân A4"];
  }, [slotsQuery.data?.items]);

  const slotMap = useMemo(() => {
    const map = new Map<string, NonNullable<typeof selectedSlot>>();
    for (const slot of slotsQuery.data?.items || []) {
      const startLabel = toTimeLabel(slot.startTime);
      map.set(`${slot.fieldName}__${startLabel}`, slot);
    }
    return map;
  }, [slotsQuery.data?.items]);

  const totalMinutes = selectedSlot
    ? Math.max(0, (new Date(selectedSlot.endTime).getTime() - new Date(selectedSlot.startTime).getTime()) / 60000)
    : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#4D5E73" />
          </Pressable>
          <Text style={styles.headerTitle}>Đặt lịch trực quan</Text>
          <Ionicons name="information-circle-outline" size={20} color="#8A98A9" />
        </View>

        <Text style={styles.dateTitle}>{selectedDate.split("-").reverse().join("/")}</Text>
        <Text style={styles.dateSub}>Chọn ngày để xem lịch trống theo sân</Text>
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
                  setSelectedCellKey("");
                }}
              >
                <Text style={[styles.dateCellWeek, active && styles.dateCellTextActive]}>T{weekdayFromDate(item.value)}</Text>
                <Text style={[styles.dateCellText, active && styles.dateCellTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <LegendDot color="#D9DFE7" label="Không có slot" />
          <LegendDot color="#E8FCF3" label="Có thể chọn" />
          <LegendDot color="#42B883" label="Đã chọn" />
        </View>

        <View style={styles.tableOuter}>
          <ScrollView horizontal showsHorizontalScrollIndicator={true}>
            <View>
              <View style={styles.tableHeaderRow}>
                <View style={styles.tableTimeHeaderCell}>
                  <Text style={styles.tableHeaderText}>Giờ</Text>
                </View>
                {fieldRows.map((fieldName) => (
                  <View key={fieldName} style={styles.tableFieldHeaderCell}>
                    <Text style={styles.tableHeaderText}>{fieldName}</Text>
                  </View>
                ))}
              </View>
              <ScrollView style={styles.tableBodyScroll} nestedScrollEnabled>
                {timelineTimes.map((time, rowIdx) => (
                  <View key={time} style={[styles.tableDataRow, rowIdx % 2 === 1 && styles.tableDataRowAlt]}>
                    <View style={styles.tableTimeLabelCell}>
                      <Text style={styles.tableTimeLabelText}>{time}</Text>
                    </View>
                    {fieldRows.map((fieldName, fieldIdx) => {
                      const matchedSlot = slotMap.get(`${fieldName}__${time}`);
                      const cellKey = `${fieldName}__${time}`;
                      const demoAvailable = !matchedSlot && isDemoAvailable(time, fieldIdx);
                      const active = matchedSlot?.id === selectedSlotId || (!matchedSlot && selectedCellKey === cellKey);
                      const isAvailable = !!matchedSlot || demoAvailable;
                      return (
                        <Pressable
                          key={`${fieldName}-${time}`}
                          style={[
                            styles.tableSlotCell,
                            isAvailable ? styles.tableSlotCellAvailable : styles.tableSlotCellBooked,
                            active && styles.tableSlotCellActive
                          ]}
                          onPress={() => {
                            if (matchedSlot) {
                              setSelectedSlotId(matchedSlot.id);
                              setSelectedCellKey(cellKey);
                              return;
                            }
                            if (demoAvailable) {
                              setSelectedSlotId("");
                              setSelectedCellKey(cellKey);
                            }
                          }}
                        >
                          {active && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            </View>
          </ScrollView>
        </View>

        {!!selectedSlot && (
          <View style={styles.venueInfoCard}>
            <View style={styles.venueThumb}>
              <ImagePlaceholder height={52} borderRadius={8} label="Sân" imageUrl="https://picsum.photos/seed/schedule-venue/500/300" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryTitle}>{params.venueName || "Sân bóng Đại học Bách Khoa"}</Text>
              <Text style={styles.summaryText}>Sân {selectedSlot.fieldName} • Kích thước 30m x 50m</Text>
              <Text style={styles.summaryRating}>⭐ 4.8 (120 đánh giá)</Text>
            </View>
          </View>
        )}

        <View style={styles.totalBox}>
          <View style={styles.totalRow}>
            <Ionicons name="time-outline" size={15} color="#8A98A9" />
            <Text style={styles.totalLabel}>Tổng giờ:</Text>
            <Text style={styles.totalValue}>{selectedSlot ? `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}` : "--"}</Text>
          </View>
          <View style={styles.totalRow}>
            <Ionicons name="wallet-outline" size={15} color="#8A98A9" />
            <Text style={styles.totalLabel}>Tổng tiền:</Text>
            <Text style={styles.totalPrice}>
              {selectedSlot
                ? new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(selectedSlot.pricePerSlot)
                : "--"}
            </Text>
            {!!selectedSlot && (
              <Text style={styles.totalTag}>
                {selectedSlot.fieldName}{" "}
                {new Date(selectedSlot.startTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} -{" "}
                {new Date(selectedSlot.endTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            )}
          </View>
        </View>

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
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#1A2B3F" },
  dateTitle: { textAlign: "center", fontSize: 28, fontWeight: "800", color: "#1A2B3F" },
  dateSub: { textAlign: "center", fontSize: 12, color: "#8091A5", marginTop: -4 },
  dateRow: { flexDirection: "row", gap: 8, justifyContent: "space-between", marginTop: 2 },
  dateCell: {
    width: 50,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#E7EDF6",
    alignItems: "center"
  },
  dateCellActive: { backgroundColor: "#13B274" },
  dateCellWeek: { fontSize: 10, color: "#7A8898", fontWeight: "700" },
  dateCellText: { fontWeight: "700", color: "#293D54" },
  dateCellTextActive: { color: "#fff" },
  legendRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingHorizontal: 4 },
  tableOuter: {
    borderWidth: 1,
    borderColor: "#D5E0EE",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff"
  },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#DDE5F0", backgroundColor: "#F7FAFD" },
  tableBodyScroll: { maxHeight: 320 },
  tableDataRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#EEF2F8" },
  tableDataRowAlt: { backgroundColor: "#F9FBFE" },
  tableTimeHeaderCell: {
    width: 62,
    minHeight: 40,
    borderRightWidth: 1,
    borderColor: "#DDE5F0",
    alignItems: "center",
    justifyContent: "center"
  },
  tableFieldHeaderCell: {
    width: 102,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderColor: "#EEF2F8"
  },
  tableHeaderText: { color: "#5E7088", fontWeight: "700", fontSize: 12 },
  tableTimeLabelCell: {
    width: 62,
    minHeight: 38,
    borderRightWidth: 1,
    borderColor: "#EEF2F8",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FBFCFE"
  },
  tableTimeLabelText: { color: "#6B7D94", fontSize: 11, fontWeight: "700" },
  tableSlotCell: {
    width: 102,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderColor: "#EEF2F8",
    backgroundColor: "#FFFFFF"
  },
  tableSlotCellAvailable: {
    backgroundColor: "#FFFFFF"
  },
  tableSlotCellBooked: {
    backgroundColor: "#E3E8EF"
  },
  tableSlotCellActive: {
    backgroundColor: "#42B883"
  },
  venueInfoCard: {
    borderWidth: 1,
    borderColor: "#D5E0EE",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  venueThumb: { width: 52 },
  summaryTitle: { fontSize: 14, fontWeight: "800", color: "#2A3E56" },
  summaryText: { color: "#7C8CA0", fontSize: 12, marginTop: 2 },
  summaryRating: { color: "#0F9464", fontSize: 12, marginTop: 2, fontWeight: "700" },
  totalBox: { gap: 8, marginTop: 2 },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  totalLabel: { color: "#7A889A", fontWeight: "600" },
  totalValue: { color: "#2F435A", fontWeight: "700" },
  totalPrice: { color: "#0D9B67", fontSize: 28, fontWeight: "900" },
  totalTag: { marginLeft: "auto", backgroundColor: "#E0F6EC", color: "#129467", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, overflow: "hidden", fontWeight: "700" },
  nextButton: {
    marginTop: 8,
    backgroundColor: "#087B57",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center"
  },
  nextButtonText: { color: "#fff", fontWeight: "900", letterSpacing: 1 }
});

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: color }} />
      <Text style={{ color: "#6C7C91", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function buildTimelineLabels() {
  const labels: string[] = [];
  for (let minutes = 5 * 60; minutes <= 23 * 60; minutes += 30) {
    const h = Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0");
    const m = (minutes % 60).toString().padStart(2, "0");
    labels.push(`${h}:${m}`);
  }
  return labels;
}

function toTimeLabel(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function weekdayFromDate(dateStr: string) {
  const d = new Date(dateStr);
  const wd = d.getDay();
  return wd === 0 ? 8 : wd + 1;
}

function isDemoAvailable(time: string, fieldIndex: number) {
  const [h, m] = time.split(":").map(Number);
  const halfHourIndex = h * 2 + (m === 30 ? 1 : 0);
  return (halfHourIndex + fieldIndex * 3) % 5 === 0;
}
