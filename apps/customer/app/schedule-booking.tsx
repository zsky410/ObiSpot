import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImagePlaceholder } from "../src/components/ImagePlaceholder";
import { pitchImageByKey } from "../src/lib/pitchImages";
import { ApiRequestError, createBookingApi, getSlotsApi, type Slot, type SlotBusyRange } from "../src/lib/api";
import { formatVnd, getDateOffsetVietnam, weekdayFromDate } from "../src/lib/dateVietnam";
import { useAuth } from "../src/store/auth";

type BoundarySelection = {
  fieldName: string;
  startLabel: string;
  endLabel: string;
};

export default function ScheduleBookingScreen() {
  const { getValidAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    venueId?: string;
    venueName?: string;
    venueAddress?: string;
    pitchFormat?: string;
  }>();
  const venueId = params.venueId || "";
  const pitchFormat: "5v5" | "7v7" = params.pitchFormat === "7v7" ? "7v7" : "5v5";
  const [selectedDate, setSelectedDate] = useState(() => getDateOffsetVietnam(0));
  /** Timeline dùng theo mốc thời gian: chọn mốc bắt đầu và mốc kết thúc, slot thật nằm ở giữa hai mốc. */
  const [selection, setSelection] = useState<BoundarySelection | null>(null);

  function clearRangeSelection() {
    setSelection(null);
  }

  const dateOptions = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, i) => {
        const d = getDateOffsetVietnam(i);
        return { value: d, label: d.slice(8, 10) };
      }),
    []
  );

  const slotsQuery = useQuery({
    queryKey: ["slots", selectedDate, venueId, pitchFormat],
    enabled: !!venueId,
    queryFn: () => getSlotsApi(selectedDate, venueId, pitchFormat)
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { ids: string[]; totalPriceVnd: number }) => {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      const data = await createBookingApi(accessToken, payload.ids, "Đặt từ màn đặt lịch trực quan");
      return { data, totalPriceVnd: payload.totalPriceVnd };
    },
    onSuccess: ({ data, totalPriceVnd }) => {
      queryClient.invalidateQueries({ queryKey: ["slots", selectedDate, venueId, pitchFormat] });
      queryClient.invalidateQueries({ queryKey: ["slots"] });
      queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      router.replace({
        pathname: "/booking-success",
        params: {
          bookingId: data.id,
          venueId: venueId || "",
          venueName: params.venueName || "Sân",
          selectedDate,
          totalPrice: String(totalPriceVnd)
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

  const slotItems = slotsQuery.data?.items ?? [];
  const timelineTimes = useMemo(() => buildTimelineLabels(), []);

  useFocusEffect(
    useCallback(() => {
      if (venueId) {
        queryClient.invalidateQueries({ queryKey: ["slots", selectedDate, venueId, pitchFormat] });
      }
      return undefined;
    }, [queryClient, selectedDate, venueId, pitchFormat])
  );

  const selectedSorted = useMemo(
    () => slotsFromBoundarySelection(slotItems, selection, selectedDate),
    [slotItems, selection, selectedDate]
  );

  const firstSel = selectedSorted[0];
  const lastSel = selectedSorted[selectedSorted.length - 1];

  const fieldRows = useMemo(() => {
    const uniq = Array.from(new Set(slotItems.map((slot) => slot.fieldName))).filter(Boolean);
    if (uniq.length > 0) {
      return uniq;
    }
    return pitchFormat === "7v7" ? ["Sân 7A", "Sân 7B", "Sân 7C"] : ["Sân 5A", "Sân 5B", "Sân 5C"];
  }, [slotItems, pitchFormat]);

  const boundaryMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const slot of slotItems) {
      for (const label of [slotGridRowKey(slot.startTime, selectedDate), slotGridRowKey(slot.endTime, selectedDate)]) {
        if (!label) {
          continue;
        }
        const set = map.get(slot.fieldName) ?? new Set<string>();
        set.add(label);
        map.set(slot.fieldName, set);
      }
    }
    return map;
  }, [slotItems, selectedDate]);

  const busyRanges: SlotBusyRange[] = slotsQuery.data?.busyRanges ?? [];

  const activeBoundaryKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!selection) {
      return keys;
    }

    const startIdx = timelineTimes.indexOf(selection.startLabel);
    const endIdx = timelineTimes.indexOf(selection.endLabel);
    if (startIdx === -1 || endIdx === -1) {
      return keys;
    }

    const from = Math.min(startIdx, endIdx);
    const to = Math.max(startIdx, endIdx);
    for (let i = from; i <= to; i++) {
      keys.add(`${selection.fieldName}__${timelineTimes[i]}`);
    }
    return keys;
  }, [selection, timelineTimes]);

  const totalMinutes = selectedSorted.reduce((acc, s) => acc + slotDurationMinutes(s), 0);
  /** Luôn bám giá backend trả về cho từng slot để khớp rule và dữ liệu booking thật. */
  const totalPriceVnd = selectedSorted.reduce((acc, s) => acc + slotPriceVnd(s), 0);

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
        <Text style={styles.dateSub}>
          {pitchFormat === "7v7" ? "Sân 7 người" : "Sân 5 người"} — lịch trống theo từng sân
        </Text>
        <View style={styles.dateRow}>
          {dateOptions.map((item) => {
            const active = selectedDate === item.value;
            return (
              <Pressable
                key={item.value}
                style={[styles.dateCell, active && styles.dateCellActive]}
                onPress={() => {
                  setSelectedDate(item.value);
                  clearRangeSelection();
                }}
              >
                <Text style={[styles.dateCellWeek, active && styles.dateCellTextActive]}>T{weekdayFromDate(item.value)}</Text>
                <Text style={[styles.dateCellText, active && styles.dateCellTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legendBar}>
          <View style={styles.legendRow}>
            <LegendDot color="#D9DFE7" label="Đã đặt hoặc không mở" />
            <LegendDot color="#E8FCF3" label="Có thể chọn" />
            <LegendDot color="#42B883" label="Đã chọn" />
          </View>
          {selection ? (
            <Pressable style={styles.clearSelectionBtn} hitSlop={10} onPress={clearRangeSelection}>
              <Text style={styles.clearSelectionText}>Bỏ chọn</Text>
            </Pressable>
          ) : null}
        </View>
        {!venueId ? (
          <Text style={styles.slotsEmptyHint}>Thiếu mã chi nhánh — quay lại chọn chi nhánh rồi mở đặt lịch.</Text>
        ) : null}

        {slotsQuery.isError ? (
          <View style={styles.slotsErrorBox}>
            <Text style={styles.slotsErrorTitle}>Không tải được lịch slot</Text>
            <Text style={styles.slotsErrorText}>
              {slotsQuery.error instanceof ApiRequestError
                ? slotsQuery.error.message
                : slotsQuery.error instanceof Error
                  ? slotsQuery.error.message
                  : "Lỗi mạng hoặc máy chủ."}
            </Text>
            <Text style={styles.slotsErrorHint}>
              Kiểm tra backend đang chạy và đã restart sau khi sửa API. Điện thoại và máy dev cùng mạng.
            </Text>
            <Pressable style={styles.retryBtnSmall} onPress={() => slotsQuery.refetch()}>
              <Text style={styles.retryBtnSmallText}>Thử lại</Text>
            </Pressable>
          </View>
        ) : null}

        {slotsQuery.isSuccess && venueId && (slotsQuery.data?.items?.length ?? 0) === 0 ? (
          <Text style={styles.slotsEmptyHint}>
            Không có slot trống cho ngày này (seed chỉ có ~14 ngày kể từ lúc chạy SQL — thử đổi ngày trong tuần đầu).
          </Text>
        ) : null}

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
                    {fieldRows.map((fieldName) => {
                      const cellKey = `${fieldName}__${time}`;
                      const active = activeBoundaryKeys.has(cellKey);
                      const overlapsBookedSlice = timelineSliceOverlapsBusy(
                        fieldName,
                        time,
                        selectedDate,
                        busyRanges
                      );
                      const isBoundaryFree = boundaryMap.get(fieldName)?.has(time) ?? false;
                      const isAvailable = !overlapsBookedSlice && isBoundaryFree;
                      return (
                        <Pressable
                          key={`${fieldName}-${time}`}
                          style={[
                            styles.tableSlotCell,
                            isAvailable ? styles.tableSlotCellAvailable : styles.tableSlotCellBooked,
                            active && styles.tableSlotCellActive
                          ]}
                          onPress={() => {
                            if (isAvailable) {
                              setSelection((prev) =>
                                applyBoundaryTap(slotItems, prev, fieldName, time, selectedDate, timelineTimes)
                              );
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

        {!!firstSel && (
          <View style={styles.venueInfoCard}>
            <View style={styles.venueThumb}>
              <ImagePlaceholder height={52} borderRadius={8} source={pitchImageByKey(venueId || "schedule")} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryTitle}>{params.venueName || "Sân bóng Đại học Bách Khoa"}</Text>
              <Text style={styles.summaryText}>
                Sân {firstSel.fieldName} • {slotGridRowKey(firstSel.startTime, selectedDate) ?? "—"} —{" "}
                {slotGridRowKey(lastSel?.endTime ?? firstSel.endTime, selectedDate) ?? "—"}
              </Text>
              <Text style={styles.summaryRating}>⭐ 4.8 (120 đánh giá)</Text>
            </View>
          </View>
        )}

        <View style={styles.totalBox}>
          <View style={styles.totalRow}>
            <Ionicons name="time-outline" size={15} color="#8A98A9" />
            <Text style={styles.totalLabel}>Tổng giờ:</Text>
            <Text style={styles.totalValue}>
              {firstSel ? `${Math.floor(totalMinutes / 60)}h${String(totalMinutes % 60).padStart(2, "0")}` : "--"}
            </Text>
          </View>
          <View style={styles.totalRow}>
            <Ionicons name="wallet-outline" size={15} color="#8A98A9" />
            <Text style={styles.totalLabel}>Tổng tiền:</Text>
            <Text style={styles.totalPrice}>
              {firstSel
                ? new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(totalPriceVnd)
                : "--"}
            </Text>
            {!!firstSel && lastSel && (
              <Text style={styles.totalTag}>
                {firstSel.fieldName} {slotGridRowKey(firstSel.startTime, selectedDate) ?? "—"} —{" "}
                {slotGridRowKey(lastSel.endTime, selectedDate) ?? "—"}
              </Text>
            )}
          </View>
        </View>

        <Pressable
          style={[styles.nextButton, (selectedSorted.length === 0 || createMutation.isPending) && { opacity: 0.6 }]}
          disabled={selectedSorted.length === 0 || createMutation.isPending}
          onPress={() =>
            createMutation.mutate({
              ids: selectedSorted.map((s) => s.id),
              totalPriceVnd
            })
          }
        >
          <Text style={styles.nextButtonText}>{createMutation.isPending ? "Đang xử lý..." : "TIẾP THEO"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function slotMs(iso: string) {
  return new Date(iso).getTime();
}

function slotDurationMinutes(s: Slot) {
  return Math.max(0, (slotMs(s.endTime) - slotMs(s.startTime)) / 60000);
}

function slotPriceVnd(s: Slot) {
  return Number.isFinite(s.pricePerSlot) ? s.pricePerSlot : 0;
}

function boundaryLabelMs(gridDateYmd: string, timeLabel: string) {
  return new Date(`${gridDateYmd}T${timeLabel}:00+07:00`).getTime();
}

/** Ô lưới `[rowLabel, rowLabel+30p)` có giao phần không rỗng với khoảng bận không. */
function timelineSliceOverlapsBusy(
  fieldName: string,
  rowTimeLabel: string,
  gridDateYmd: string,
  ranges: SlotBusyRange[]
): boolean {
  const sliceStartMs = boundaryLabelMs(gridDateYmd, rowTimeLabel);
  const sliceEndMs = sliceStartMs + 30 * 60 * 1000;
  return ranges.some((b) => {
    if (b.fieldName !== fieldName) {
      return false;
    }
    const bs = slotMs(b.startTime);
    const be = slotMs(b.endTime);
    return sliceStartMs < be && bs < sliceEndMs;
  });
}

/** HH:mm: phút từ 00:00 ngày `gridDateYmd` (+07) tới `iso`. */
function slotGridRowKey(iso: string | Date, gridDateYmd: string): string | null {
  const dayStartMs = new Date(`${gridDateYmd}T00:00:00+07:00`).getTime();
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(dayStartMs)) {
    return null;
  }
  const deltaMin = Math.round((t - dayStartMs) / 60000);
  if (deltaMin < 0 || deltaMin >= 24 * 60) {
    return null;
  }
  const h = Math.floor(deltaMin / 60);
  const m = deltaMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function pickSlotsInHalfOpen(
  items: Slot[],
  fieldName: string,
  tStart: number,
  tEndExclusive: number
): Slot[] | null {
  if (tEndExclusive <= tStart) {
    return null;
  }
  const row = items
    .filter((s) => s.fieldName === fieldName)
    .sort((a, b) => slotMs(a.startTime) - slotMs(b.startTime));
  const picked = row.filter(
    (s) => slotMs(s.startTime) >= tStart && slotMs(s.endTime) <= tEndExclusive
  );
  if (picked.length === 0) {
    return null;
  }
  for (let i = 1; i < picked.length; i++) {
    if (slotMs(picked[i].startTime) !== slotMs(picked[i - 1].endTime)) {
      return null;
    }
  }
  return picked;
}

function normalizeBoundarySelection(
  fieldName: string,
  startLabel: string,
  endLabel: string,
  gridDateYmd: string
): BoundarySelection {
  return boundaryLabelMs(gridDateYmd, startLabel) <= boundaryLabelMs(gridDateYmd, endLabel)
    ? { fieldName, startLabel, endLabel }
    : { fieldName, startLabel: endLabel, endLabel: startLabel };
}

function slotsFromBoundarySelection(
  items: Slot[],
  selection: BoundarySelection | null,
  gridDateYmd: string
): Slot[] {
  if (!selection) {
    return [];
  }

  const tStart = boundaryLabelMs(gridDateYmd, selection.startLabel);
  const tEndExclusive = boundaryLabelMs(gridDateYmd, selection.endLabel);
  if (!(tEndExclusive > tStart)) {
    return [];
  }

  return pickSlotsInHalfOpen(items, selection.fieldName, tStart, tEndExclusive) ?? [];
}

/**
 * Timeline coi mỗi ô là một mốc thời gian. Giá/booking lấy các slot nằm giữa mốc đầu và mốc cuối.
 */
function applyBoundaryTap(
  items: Slot[],
  previous: BoundarySelection | null,
  fieldName: string,
  timeLabel: string,
  gridDateYmd: string,
  timelineTimes: string[]
): BoundarySelection | null {
  if (!previous || previous.fieldName !== fieldName) {
    return { fieldName, startLabel: timeLabel, endLabel: timeLabel };
  }

  if (previous.startLabel === previous.endLabel) {
    if (timeLabel === previous.startLabel) {
      return null;
    }

    const candidate = normalizeBoundarySelection(fieldName, previous.startLabel, timeLabel, gridDateYmd);
    return slotsFromBoundarySelection(items, candidate, gridDateYmd).length > 0
      ? candidate
      : { fieldName, startLabel: timeLabel, endLabel: timeLabel };
  }

  if (timeLabel === previous.startLabel || timeLabel === previous.endLabel) {
    return { fieldName, startLabel: timeLabel, endLabel: timeLabel };
  }

  const clickedIdx = timelineTimes.indexOf(timeLabel);
  const startIdx = timelineTimes.indexOf(previous.startLabel);
  const endIdx = timelineTimes.indexOf(previous.endLabel);
  if (clickedIdx === -1 || startIdx === -1 || endIdx === -1) {
    return { fieldName, startLabel: timeLabel, endLabel: timeLabel };
  }

  let candidate: BoundarySelection;
  if (clickedIdx < startIdx) {
    candidate = { fieldName, startLabel: timeLabel, endLabel: previous.endLabel };
  } else if (clickedIdx > endIdx) {
    candidate = { fieldName, startLabel: previous.startLabel, endLabel: timeLabel };
  } else {
    const distToStart = clickedIdx - startIdx;
    const distToEnd = endIdx - clickedIdx;
    candidate =
      distToStart <= distToEnd
        ? { fieldName, startLabel: timeLabel, endLabel: previous.endLabel }
        : { fieldName, startLabel: previous.startLabel, endLabel: timeLabel };
  }

  const normalized = normalizeBoundarySelection(
    candidate.fieldName,
    candidate.startLabel,
    candidate.endLabel,
    gridDateYmd
  );
  return slotsFromBoundarySelection(items, normalized, gridDateYmd).length > 0
    ? normalized
    : { fieldName, startLabel: timeLabel, endLabel: timeLabel };
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
  legendBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 4
  },
  legendRow: { flexDirection: "row", justifyContent: "space-between", flex: 1 },
  clearSelectionBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  clearSelectionText: { color: "#087B57", fontWeight: "800", fontSize: 12 },
  slotsErrorBox: {
    borderWidth: 1,
    borderColor: "#F0CACA",
    backgroundColor: "#FFF5F5",
    borderRadius: 10,
    padding: 10,
    gap: 6
  },
  slotsErrorTitle: { fontWeight: "800", color: "#9B2C2C", fontSize: 14 },
  slotsErrorText: { color: "#5B6574", fontSize: 12 },
  slotsErrorHint: { color: "#6C7C91", fontSize: 11, lineHeight: 16 },
  retryBtnSmall: {
    alignSelf: "flex-start",
    backgroundColor: "#087B57",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4
  },
  retryBtnSmallText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  slotsEmptyHint: { color: "#6C7C91", fontSize: 12, lineHeight: 18, paddingHorizontal: 2 },
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

