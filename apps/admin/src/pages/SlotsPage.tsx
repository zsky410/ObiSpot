import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  type AdminSlot,
  type AdminSlotBookingDetail,
  ApiRequestError,
  getAdminFieldsApi,
  getAdminSlotBookingDetailApi,
  getAdminSlotsApi,
  getVenuesApi,
  patchAdminSlotsBulkStatusApi
} from "../lib/api";
import { useAuth } from "../store/auth";

type TimelineCellInfo = {
  status: "none" | "available" | "blocked" | "booked";
  availableIds: string[];
  blockedIds: string[];
  bookedIds: string[];
  bookingGroupIds: string[];
};

type BookedTimelineBlock = {
  fieldId: string;
  bookingGroupId: string;
  slotId: string;
  startTime: string;
  endTime: string;
  startLabel: string;
  rowSpan: number;
};

const SLOT_ACTION_COPY: Record<
  "block" | "unblock" | "reserve",
  { label: string; cta: string }
> = {
  block: {
    label: "Khóa slot",
    cta: "Khóa các ô đã chọn"
  },
  unblock: {
    label: "Mở slot",
    cta: "Mở lại các ô đã chọn"
  },
  reserve: {
    label: "Đặt giữ slot",
    cta: "Đặt giữ các ô đã chọn"
  }
};

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

export function SlotsPage() {
  const { getValidAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => getVietnamDateInputValue(new Date()));
  const [expandedVenueId, setExpandedVenueId] = useState("");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [actionMode, setActionMode] = useState<"block" | "unblock" | "reserve">("block");
  const [selectedCellKeys, setSelectedCellKeys] = useState<string[]>([]);
  const [activeBookedSlotId, setActiveBookedSlotId] = useState<string | null>(null);
  const hiddenDateInputRef = useRef<HTMLInputElement | null>(null);

  const venuesQuery = useQuery({
    queryKey: ["venues"],
    queryFn: getVenuesApi,
    staleTime: 5 * 60 * 1000
  });

  const slotsQuery = useQuery({
    queryKey: ["admin-slots", date, expandedVenueId],
    enabled: !!expandedVenueId,
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return getAdminSlotsApi(token, date, expandedVenueId);
    }
  });

  const fieldsQuery = useQuery({
    queryKey: ["admin-fields", expandedVenueId],
    enabled: !!expandedVenueId,
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return getAdminFieldsApi(token, expandedVenueId);
    },
    staleTime: 5 * 60 * 1000
  });
  const bookedSlotDetailQuery = useQuery({
    queryKey: ["admin-slot-booking-detail", activeBookedSlotId],
    enabled: !!activeBookedSlotId,
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return getAdminSlotBookingDetailApi(token, activeBookedSlotId as string);
    }
  });

  const fields = useMemo(() => fieldsQuery.data?.items || [], [fieldsQuery.data?.items]);
  const venues = venuesQuery.data?.items || [];
  const actionCopy = SLOT_ACTION_COPY[actionMode];
  const dateLabel = useMemo(() => formatDateLabel(date), [date]);

  const toggleMutation = useMutation({
    mutationFn: async (payload: { slotIds: string[]; nextStatus: "available" | "blocked" }) => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return patchAdminSlotsBulkStatusApi(token, { slotIds: payload.slotIds, status: payload.nextStatus });
    },
    onMutate: async (payload) => {
      const key = ["admin-slots", date, expandedVenueId] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: AdminSlot[] }>(key);
      queryClient.setQueryData<{ items: AdminSlot[] }>(key, (old) => {
        if (!old) return old;
        const idSet = new Set(payload.slotIds);
        return {
          ...old,
          items: old.items.map((slot) => {
            if (slot.status === "booked") return slot;

            const availableSlotIds = slot.availableSlotIds || [];
            const blockedSlotIds = slot.blockedSlotIds || [];
            const touchesAvailable = availableSlotIds.some((id) => idSet.has(id));
            const touchesBlocked = blockedSlotIds.some((id) => idSet.has(id));

            if (payload.nextStatus === "blocked" && touchesAvailable) {
              const movedIds = availableSlotIds.filter((id) => idSet.has(id));
              return {
                ...slot,
                status: "blocked" as const,
                availableSlotIds: availableSlotIds.filter((id) => !idSet.has(id)),
                blockedSlotIds: uniqueIds([...blockedSlotIds, ...movedIds])
              };
            }

            if (payload.nextStatus === "available" && touchesBlocked) {
              const movedIds = blockedSlotIds.filter((id) => idSet.has(id));
              const nextBlockedIds = blockedSlotIds.filter((id) => !idSet.has(id));
              return {
                ...slot,
                status: nextBlockedIds.length ? "blocked" as const : "available" as const,
                availableSlotIds: uniqueIds([...availableSlotIds, ...movedIds]),
                blockedSlotIds: nextBlockedIds
              };
            }

            return slot;
          })
        };
      });
      return { previous, key };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(ctx.key, ctx.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-slots", date, expandedVenueId] });
    }
  });

  const visibleFields = useMemo(() => {
    if (fieldFilter === "all") return fields;
    return fields.filter((field) => field.id === fieldFilter);
  }, [fields, fieldFilter]);
  const timelineLabels = useMemo(() => buildTimelineLabels("05:00", "22:30"), []);
  const slotCellInfoMap = useMemo(() => {
    const map = new Map<string, TimelineCellInfo>();

    // Mỗi ô timeline là 1 lát 30 phút, có mốc đều nhau.
    // Thay vì duyệt tất cả nhãn cho mỗi slot (O(n*m)), ta tính chỉ số lát bị slot phủ lên.
    const stepMs = 30 * 60 * 1000;
    const timelineStartMs = boundaryLabelMs(date, timelineLabels[0]);
    const timelineCount = timelineLabels.length;

    for (const slot of slotsQuery.data?.items || []) {
      const slotStartMs = new Date(slot.startTime).getTime();
      const slotEndMs = new Date(slot.endTime).getTime();

      // i sao cho: labelMs < slotEnd && slotStart < labelMs+step
      // labelMs = timelineStartMs + i*step
      const iStart = Math.floor((slotStartMs - timelineStartMs) / stepMs);
      const iEnd = Math.ceil((slotEndMs - timelineStartMs) / stepMs) - 1;

      const from = Math.max(0, iStart);
      const to = Math.min(timelineCount - 1, iEnd);
      if (from > to) continue;

      for (let i = from; i <= to; i += 1) {
        const label = timelineLabels[i];
        const labelStartMs = timelineStartMs + i * stepMs;
        const labelEndMs = labelStartMs + stepMs;
        if (!(labelStartMs < slotEndMs && slotStartMs < labelEndMs)) continue; // chốt lại off-by-one

        const key = `${slot.fieldId}__${label}`;
        const current = map.get(key) || {
          status: "none" as const,
          availableIds: [],
          blockedIds: [],
          bookedIds: [],
          bookingGroupIds: []
        };
        if (slot.status === "booked") {
          current.bookedIds.push(...(slot.bookedSlotIds?.length ? slot.bookedSlotIds : [slot.id]));
          if (slot.bookingGroupId) current.bookingGroupIds.push(slot.bookingGroupId);
        }
        else if (slot.status === "blocked") {
          current.blockedIds.push(...(slot.blockedSlotIds?.length ? slot.blockedSlotIds : [slot.id]));
        }
        else {
          current.availableIds.push(...(slot.availableSlotIds?.length ? slot.availableSlotIds : [slot.id]));
        }
        map.set(key, current);
      }
    }
    for (const [key, value] of map.entries()) {
      const status = value.bookedIds.length
        ? "booked"
        : value.blockedIds.length
          ? "blocked"
          : value.availableIds.length
            ? "available"
            : "none";
      map.set(key, {
        ...value,
        status,
        availableIds: uniqueIds(value.availableIds),
        blockedIds: uniqueIds(value.blockedIds),
        bookedIds: uniqueIds(value.bookedIds),
        bookingGroupIds: uniqueIds(value.bookingGroupIds)
      });
    }
    return map;
  }, [slotsQuery.data?.items, timelineLabels, date]);
  const bookedBlockLayout = useMemo(() => {
    const byStartKey = new Map<string, BookedTimelineBlock>();
    const coveredCellKeys = new Set<string>();
    const stepMs = 30 * 60 * 1000;
    const timelineStartMs = boundaryLabelMs(date, timelineLabels[0]);
    const bookedSlotsByGroup = new Map<string, AdminSlot[]>();

    for (const slot of slotsQuery.data?.items || []) {
      if (slot.status !== "booked") continue;
      const bookingGroupId = slot.bookingGroupId || slot.id;
      const key = `${slot.fieldId}__${bookingGroupId}`;
      const current = bookedSlotsByGroup.get(key) || [];
      current.push(slot);
      bookedSlotsByGroup.set(key, current);
    }

    for (const [groupKey, groupSlots] of bookedSlotsByGroup.entries()) {
      const [fieldId, bookingGroupId] = groupKey.split("__");
      const sortedSlots = [...groupSlots].sort((a, b) => slotMs(a.startTime) - slotMs(b.startTime));
      let segment: AdminSlot[] = [];
      let segmentEndMs = 0;

      const commitSegment = () => {
        if (!segment.length) return;
        const segmentStartMs = slotMs(segment[0].startTime);
        const segmentEndTime = segment.reduce(
          (latest, slot) => (slotMs(slot.endTime) > slotMs(latest) ? slot.endTime : latest),
          segment[0].endTime
        );
        const segmentEndMsValue = slotMs(segmentEndTime);
        const startIndex = Math.max(0, Math.floor((segmentStartMs - timelineStartMs) / stepMs));
        const endIndexExclusive = Math.min(timelineLabels.length, Math.ceil((segmentEndMsValue - timelineStartMs) / stepMs));
        const rowSpan = endIndexExclusive - startIndex;
        if (rowSpan <= 0) {
          segment = [];
          segmentEndMs = 0;
          return;
        }
        const startLabel = timelineLabels[startIndex];
        byStartKey.set(`${fieldId}__${startLabel}`, {
          fieldId,
          bookingGroupId,
          slotId: segment[0].id,
          startTime: segment[0].startTime,
          endTime: segmentEndTime,
          startLabel,
          rowSpan
        });
        for (let i = startIndex + 1; i < endIndexExclusive; i += 1) {
          coveredCellKeys.add(`${fieldId}__${timelineLabels[i]}`);
        }
        segment = [];
        segmentEndMs = 0;
      };

      for (const slot of sortedSlots) {
        if (!segment.length) {
          segment = [slot];
          segmentEndMs = slotMs(slot.endTime);
          continue;
        }
        const nextStartMs = slotMs(slot.startTime);
        if (nextStartMs > segmentEndMs) {
          commitSegment();
          segment = [slot];
          segmentEndMs = slotMs(slot.endTime);
          continue;
        }
        segment.push(slot);
        segmentEndMs = Math.max(segmentEndMs, slotMs(slot.endTime));
      }

      commitSegment();
    }

    return { byStartKey, coveredCellKeys };
  }, [slotsQuery.data?.items, timelineLabels, date]);

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setSelectedCellKeys([]);
    setActiveBookedSlotId(null);
  }

  function openDatePicker() {
    if (!hiddenDateInputRef.current) return;
    if (typeof hiddenDateInputRef.current.showPicker === "function") {
      hiddenDateInputRef.current.showPicker();
      return;
    }
    hiddenDateInputRef.current.click();
  }

  function handleVenueChange(nextVenueId: string) {
    setExpandedVenueId(nextVenueId);
    setFieldFilter("all");
    setSelectedCellKeys([]);
    setActiveBookedSlotId(null);
  }

  function handleFieldFilterChange(nextFieldId: string) {
    setFieldFilter(nextFieldId);
    setSelectedCellKeys([]);
    setActiveBookedSlotId(null);
  }

  function handleCellAction(cellKey: string, cellStatus: "none" | "available" | "blocked" | "booked") {
    if (cellStatus === "none" || cellStatus === "booked") return;
    setSelectedCellKeys((prev) =>
      prev.includes(cellKey) ? prev.filter((key) => key !== cellKey) : [...prev, cellKey]
    );
  }

  function handleTimelineCellClick(
    cellKey: string,
    cellInfo:
      | {
          status: "none" | "available" | "blocked" | "booked";
          availableIds: string[];
          blockedIds: string[];
          bookedIds: string[];
        }
      | undefined,
    bookedSlotId?: string
  ) {
    if (!cellInfo || cellInfo.status === "none") return;
    if (cellInfo.status === "booked") {
      if (bookedSlotId || cellInfo.bookedIds.length > 0) {
        setActiveBookedSlotId(bookedSlotId || cellInfo.bookedIds[0]);
      }
      return;
    }
    handleCellAction(cellKey, cellInfo.status);
  }

  const activeBooking = bookedSlotDetailQuery.data?.booking as AdminSlotBookingDetail["booking"] | undefined;

  function applyActionOnSelected() {
    if (selectedCellKeys.length === 0) {
      window.alert("Vui lòng chọn ít nhất một slot.");
      return;
    }
    const selectedCells = selectedCellKeys
      .map((key) => ({ key, info: slotCellInfoMap.get(key) }))
      .filter((row): row is { key: string; info: NonNullable<typeof row.info> } => Boolean(row.info));
    if (selectedCells.length === 0) return;
    if (selectedCells.some((cell) => cell.info.status === "booked")) {
      window.alert("Có slot đã được user đặt. Hãy bỏ chọn các ô này.");
      return;
    }

    if (actionMode === "block") {
      const targetIds = Array.from(new Set(selectedCells.flatMap((cell) => cell.info.availableIds)));
      if (targetIds.length === 0) {
        window.alert("Chỉ có thể khóa slot đang mở.");
        return;
      }
      toggleMutation
        .mutateAsync({ slotIds: targetIds, nextStatus: "blocked" })
        .then(() => setSelectedCellKeys([]))
        .catch(() => undefined);
      return;
    }
    if (actionMode === "unblock") {
      const targetIds = Array.from(new Set(selectedCells.flatMap((cell) => cell.info.blockedIds)));
      if (targetIds.length === 0) {
        window.alert("Chỉ có thể mở lại slot đang bị khóa.");
        return;
      }
      toggleMutation
        .mutateAsync({ slotIds: targetIds, nextStatus: "available" })
        .then(() => setSelectedCellKeys([]))
        .catch(() => undefined);
      return;
    }

    const targetIds = Array.from(new Set(selectedCells.flatMap((cell) => cell.info.availableIds)));
    if (targetIds.length > 0) {
      toggleMutation
        .mutateAsync({ slotIds: targetIds, nextStatus: "blocked" })
        .then(() => setSelectedCellKeys([]))
        .catch(() => undefined);
      return;
    }
    window.alert("Chỉ có thể đặt giữ với slot đang mở.");
  }

  return (
    <section className="slot-page">
      <div className="card slot-control-card">
        <div className="slot-filter-grid">
          <label className="input-col slot-input-card slot-input-card-date">
            <span>Ngày vận hành</span>
            <div className="slot-date-display-wrap">
              <input
                type="text"
                value={dateLabel}
                readOnly
                onClick={openDatePicker}
                aria-label="Ngày vận hành"
              />
              <button
                type="button"
                className="slot-date-display-btn"
                onClick={openDatePicker}
                aria-label="Chọn ngày vận hành"
              >
                <span className="slot-date-display-icon" aria-hidden="true" />
              </button>
            </div>
            <input
              ref={hiddenDateInputRef}
              type="date"
              value={date}
              onChange={(e) => {
                handleDateChange(e.target.value);
              }}
              className="slot-date-native-input"
              aria-hidden="true"
              tabIndex={-1}
            />
          </label>

          <label className="input-col slot-input-card slot-input-card-venue">
            <span>Chi nhánh</span>
            <select
              value={expandedVenueId}
              onChange={(e) => {
                handleVenueChange(e.target.value);
              }}
            >
              <option value="">Chọn chi nhánh</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          </label>

          <label className="input-col slot-input-card slot-input-card-field">
            <span>Lọc theo sân</span>
            <select
              value={fieldFilter}
              onChange={(e) => {
                handleFieldFilterChange(e.target.value);
              }}
              disabled={!expandedVenueId}
            >
              <option value="all">Tất cả sân</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>

          <label className="input-col slot-input-card slot-input-card-action">
            <span>Thao tác hàng loạt</span>
            <select value={actionMode} onChange={(e) => setActionMode(e.target.value as typeof actionMode)}>
              <option value="block">Khóa slot</option>
              <option value="unblock">Mở slot</option>
              <option value="reserve">Đặt giữ slot</option>
            </select>
          </label>
        </div>

        <div className="slot-control-footer">
          <div className="slot-control-status">
            <span className={`slot-action-pill slot-action-pill-${actionMode}`}>{actionCopy.label}</span>
            <span className="slot-selected-count">{selectedCellKeys.length} ô đã chọn</span>
          </div>
          <button
            className="btn slot-apply-btn"
            onClick={applyActionOnSelected}
            disabled={selectedCellKeys.length === 0 || toggleMutation.isPending}
          >
            {toggleMutation.isPending ? "Đang cập nhật..." : actionCopy.cta}
          </button>
        </div>
      </div>

      <div className="slot-feedback-stack">
        {venuesQuery.isError ? (
          <div className="slot-feedback slot-feedback-error">Không tải được danh sách chi nhánh.</div>
        ) : null}
        {fieldsQuery.isError ? <div className="slot-feedback slot-feedback-error">Không tải được danh sách sân.</div> : null}
        {slotsQuery.isError ? (
          <div className="slot-feedback slot-feedback-error">
            {slotsQuery.error instanceof ApiRequestError || slotsQuery.error instanceof Error
              ? slotsQuery.error.message
              : "Không tải được slots"}
          </div>
        ) : null}
      </div>

      {venues.length ? (
        <div className="slot-venue-list">
          {venues.map((venue) => {
            const open = expandedVenueId === venue.id;
            return (
              <div key={venue.id} className={`card slot-venue-item ${open ? "open" : ""}`}>
                <button
                  className={`slot-venue-toggle ${open ? "open" : ""}`}
                  type="button"
                  onClick={() => {
                    handleVenueChange(open ? "" : venue.id);
                  }}
                >
                  <div className="slot-venue-main">
                    <div>
                      <strong>{venue.name}</strong>
                      <p>{venue.address}</p>
                    </div>
                  </div>
                  <div className="slot-venue-meta">
                    <span className={`slot-venue-state ${open ? "active" : ""}`}>
                      {open ? "Đang mở" : "Xem timeline"}
                    </span>
                    <span className="slot-venue-chevron" aria-hidden="true">
                      {open ? "-" : "+"}
                    </span>
                  </div>
                </button>
                {open ? (
                  <div className="slot-venue-body">
                    {fieldsQuery.isLoading || slotsQuery.isLoading ? (
                      <div className="slot-inline-state">Đang tải danh sách sân và timeline slot...</div>
                    ) : fields.length === 0 ? (
                      <div className="slot-empty-card">Chi nhánh này chưa có sân để hiển thị timeline.</div>
                    ) : (
                      <>
                        <div className="slot-timeline-legend">
                          <span>
                            <i className="legend-dot legend-available" /> Slot trống
                          </span>
                          <span>
                            <i className="legend-dot legend-booked" /> Đã đặt
                          </span>
                          <span>
                            <i className="legend-dot legend-blocked" /> Đã khóa
                          </span>
                          <span>
                            <i className="legend-dot legend-selected" /> Đang chọn
                          </span>
                        </div>

                        {visibleFields.length ? (
                          <div className="slot-timeline-wrap">
                            <table className="slot-timeline-table">
                              <thead>
                                <tr>
                                  <th>Giờ</th>
                                  {visibleFields.map((field) => (
                                    <th key={field.id}>{field.name}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {timelineLabels.map((label) => (
                                  <tr key={label}>
                                    <td className="slot-time-col">{label}</td>
                                    {visibleFields.map((field) => {
                                      const cellKey = `${field.id}__${label}`;
                                      if (bookedBlockLayout.coveredCellKeys.has(cellKey)) {
                                        return null;
                                      }
                                      const cellInfo = slotCellInfoMap.get(cellKey);
                                      const bookedBlock = bookedBlockLayout.byStartKey.get(cellKey);
                                      const isSelected = selectedCellKeys.includes(cellKey);
                                      const cellStatusClass = bookedBlock
                                        ? "slot-cell-booked slot-cell-booked-merged"
                                        : !cellInfo || cellInfo.status === "none"
                                          ? "slot-cell-none"
                                          : cellInfo.status === "blocked"
                                            ? "slot-cell-blocked"
                                            : cellInfo.status === "booked"
                                              ? "slot-cell-booked"
                                              : "slot-cell-available";

                                      if (bookedBlock) {
                                        return (
                                          <td
                                            key={`${field.id}-${label}`}
                                            rowSpan={bookedBlock.rowSpan}
                                            className="slot-booked-merged-cell"
                                          >
                                            <button
                                              className={`slot-cell ${cellStatusClass}`}
                                              disabled={toggleMutation.isPending}
                                              onClick={() => handleTimelineCellClick(cellKey, cellInfo, bookedBlock.slotId)}
                                              title={`${field.name} · Đơn ${formatTimeRange(bookedBlock.startTime, bookedBlock.endTime)}`}
                                            >
                                              <span className="slot-booked-merged-content">
                                                {bookedBlock.rowSpan >= 2 ? formatTimeRange(bookedBlock.startTime, bookedBlock.endTime) : ""}
                                              </span>
                                            </button>
                                          </td>
                                        );
                                      }

                                      return (
                                        <td key={`${field.id}-${label}`}>
                                          <button
                                            className={`slot-cell ${cellStatusClass} ${isSelected ? "slot-cell-selected" : ""}`}
                                            disabled={!cellInfo || cellInfo.status === "none" || toggleMutation.isPending}
                                            onClick={() => handleTimelineCellClick(cellKey, cellInfo)}
                                            title={
                                              !cellInfo || cellInfo.status === "none"
                                                ? "Không có slot"
                                                : cellInfo.status === "booked"
                                                  ? `${field.name} · Xem chi tiết đơn đặt`
                                                  : cellInfo.status === "blocked"
                                                    ? `${field.name} · Slot đang khóa`
                                                    : `${field.name} · Slot đang mở`
                                            }
                                          >
                                            <span className="slot-cell-empty">&nbsp;</span>
                                          </button>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="slot-empty-card">Không có sân nào khớp với bộ lọc hiện tại.</div>
                        )}

                        {!slotsQuery.isLoading && (slotsQuery.data?.items?.length || 0) === 0 ? (
                          <p className="slot-empty-note muted">Ngày này chưa có slot.</p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Chưa có chi nhánh.</p>
      )}

      {activeBookedSlotId ? (
        <div className="slot-booking-modal-overlay" onClick={() => setActiveBookedSlotId(null)} role="presentation">
          <div className="slot-booking-modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="slot-booking-modal-head">
              <h4>Chi tiết đơn đặt sân</h4>
              <button type="button" className="slot-booking-modal-close" onClick={() => setActiveBookedSlotId(null)}>
                Đóng
              </button>
            </div>

            {bookedSlotDetailQuery.isLoading ? (
              <p className="muted">Đang tải thông tin đơn...</p>
            ) : bookedSlotDetailQuery.isError ? (
              <p className="slot-feedback slot-feedback-error">
                {bookedSlotDetailQuery.error instanceof Error
                  ? bookedSlotDetailQuery.error.message
                  : "Không tải được thông tin đơn"}
              </p>
            ) : activeBooking ? (
              <div className="slot-booking-detail-grid">
                <div>
                  <span>Mã đơn</span>
                  <strong>{activeBooking.id}</strong>
                </div>
                <div>
                  <span>Trạng thái</span>
                  <strong>{activeBooking.status === "confirmed" ? "Đã xác nhận" : "Chờ xác nhận"}</strong>
                </div>
                <div>
                  <span>Khách hàng</span>
                  <strong>{activeBooking.customer.fullName || "Không rõ"}</strong>
                </div>
                <div>
                  <span>Số điện thoại</span>
                  <strong>{activeBooking.customer.phone || "Chưa cập nhật"}</strong>
                </div>
                <div>
                  <span>Khung giờ</span>
                  <strong>
                    {formatTimeRange(activeBooking.slot.startTime, activeBooking.slot.endTime)}
                  </strong>
                </div>
                <div>
                  <span>Tổng tiền</span>
                  <strong>{formatCurrency(activeBooking.slot.totalPriceVnd)}</strong>
                </div>
                <div>
                  <span>Thời lượng</span>
                  <strong>{formatBookingSpan(activeBooking.slot.slotCount, activeBooking.slot.startTime, activeBooking.slot.endTime)}</strong>
                </div>
                <div>
                  <span>Sân</span>
                  <strong>{activeBooking.slot.fieldName || "Không rõ"}</strong>
                </div>
                <div>
                  <span>Chi nhánh</span>
                  <strong>{activeBooking.slot.venueName || "Không rõ"}</strong>
                </div>
                <div className="slot-booking-detail-full">
                  <span>Địa chỉ</span>
                  <strong>{activeBooking.slot.venueAddress || "Không rõ"}</strong>
                </div>
                <div className="slot-booking-detail-full">
                  <span>Ghi chú</span>
                  <strong>{activeBooking.note || "Không có ghi chú"}</strong>
                </div>
                <div className="slot-booking-detail-full">
                  <span>Thời điểm tạo đơn</span>
                  <strong>{formatDateTime(activeBooking.createdAt)}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">Không có dữ liệu đơn.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function formatTimeRange(start: string | null, end: string | null) {
  if (!start || !end) return "--";
  const s = new Date(start);
  const e = new Date(end);
  const fmt = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${fmt.format(s)} - ${fmt.format(e)}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function slotMs(value: string) {
  return new Date(value).getTime();
}

function formatBookingSpan(slotCount: number, start: string | null, end: string | null) {
  if (!start || !end) return `${slotCount} ô`;
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  if (!minutes) return `${slotCount} ô`;
  return `${slotCount} ô • ${minutes} phút`;
}

function getVietnamDateInputValue(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateValue: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${dateValue}T00:00:00+07:00`));
}

function boundaryLabelMs(date: string, label: string) {
  return new Date(`${date}T${label}:00+07:00`).getTime();
}

function buildTimelineLabels(startHm: string, endHm: string) {
  const labels: string[] = [];
  const [sh, sm] = startHm.split(":").map(Number);
  const [eh, em] = endHm.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  for (let minute = start; minute <= end; minute += 30) {
    const hour = Math.floor(minute / 60)
      .toString()
      .padStart(2, "0");
    const mm = (minute % 60).toString().padStart(2, "0");
    labels.push(`${hour}:${mm}`);
  }
  return labels;
}
