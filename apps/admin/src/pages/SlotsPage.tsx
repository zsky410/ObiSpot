import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  type AdminSlot,
  ApiRequestError,
  getAdminFieldsApi,
  getAdminSlotsApi,
  getVenuesApi,
  patchAdminSlotsBulkStatusApi
} from "../lib/api";
import { useAuth } from "../store/auth";

const SLOT_ACTION_COPY: Record<
  "block" | "unblock" | "reserve",
  { label: string; description: string; cta: string }
> = {
  block: {
    label: "Khóa slot",
    description: "Chuyển các slot đang mở sang trạng thái khóa để dừng nhận đặt mới.",
    cta: "Khóa các ô đã chọn"
  },
  unblock: {
    label: "Mở slot",
    description: "Mở lại các slot đang khóa để tiếp tục cho phép đặt sân.",
    cta: "Mở lại các ô đã chọn"
  },
  reserve: {
    label: "Đặt giữ slot",
    description: "Giữ chỗ thủ công bằng cách khóa nhanh các slot còn trống.",
    cta: "Đặt giữ các ô đã chọn"
  }
};

export function SlotsPage() {
  const { getValidAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => getVietnamDateInputValue(new Date()));
  const [expandedVenueId, setExpandedVenueId] = useState("");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [actionMode, setActionMode] = useState<"block" | "unblock" | "reserve">("block");
  const [selectedCellKeys, setSelectedCellKeys] = useState<string[]>([]);

  const venuesQuery = useQuery({
    queryKey: ["venues"],
    queryFn: getVenuesApi
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
    }
  });

  const fields = useMemo(() => fieldsQuery.data?.items || [], [fieldsQuery.data?.items]);
  const venues = venuesQuery.data?.items || [];
  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === expandedVenueId) || null,
    [venues, expandedVenueId]
  );
  const actionCopy = SLOT_ACTION_COPY[actionMode];
  const dateLabel = useMemo(() => formatDateLabel(date), [date]);
  const todayValue = useMemo(() => getVietnamDateInputValue(new Date()), []);
  const tomorrowValue = useMemo(() => shiftDateValue(todayValue, 1), [todayValue]);

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
          items: old.items.map((slot) =>
            idSet.has(slot.id) && slot.status !== "booked" ? { ...slot, status: payload.nextStatus } : slot
          )
        };
      });
      return { previous, key };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(ctx.key, ctx.previous);
      }
    }
  });

  const visibleFields = useMemo(() => {
    if (fieldFilter === "all") return fields;
    return fields.filter((field) => field.id === fieldFilter);
  }, [fields, fieldFilter]);
  const timelineLabels = useMemo(() => buildTimelineLabels("05:00", "22:30"), []);
  const slotCellInfoMap = useMemo(() => {
    const map = new Map<
      string,
      {
        status: "none" | "available" | "blocked" | "booked";
        availableIds: string[];
        blockedIds: string[];
        bookedIds: string[];
      }
    >();
    const labelsWithMs = timelineLabels.map((label) => ({
      label,
      startMs: boundaryLabelMs(date, label),
      endMs: boundaryLabelMs(date, label) + 30 * 60 * 1000
    }));
    for (const slot of slotsQuery.data?.items || []) {
      const slotStartMs = new Date(slot.startTime).getTime();
      const slotEndMs = new Date(slot.endTime).getTime();
      for (const period of labelsWithMs) {
        if (!(period.startMs < slotEndMs && slotStartMs < period.endMs)) continue;
        const key = `${slot.fieldId}__${period.label}`;
        const current = map.get(key) || {
          status: "none" as const,
          availableIds: [],
          blockedIds: [],
          bookedIds: []
        };
        if (slot.status === "booked") current.bookedIds.push(slot.id);
        else if (slot.status === "blocked") current.blockedIds.push(slot.id);
        else current.availableIds.push(slot.id);
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
      map.set(key, { ...value, status });
    }
    return map;
  }, [slotsQuery.data?.items, timelineLabels, date]);
  const visibleSlotSummary = useMemo(() => {
    const visibleFieldIds = new Set(visibleFields.map((field) => field.id));
    const summary = {
      total: 0,
      available: 0,
      blocked: 0,
      booked: 0
    };
    for (const slot of slotsQuery.data?.items || []) {
      if (!visibleFieldIds.has(slot.fieldId)) continue;
      summary.total += 1;
      if (slot.status === "available") summary.available += 1;
      else if (slot.status === "blocked") summary.blocked += 1;
      else summary.booked += 1;
    }
    return summary;
  }, [slotsQuery.data?.items, visibleFields]);
  const missingSlotCount = useMemo(() => {
    if (!visibleFields.length) return 0;
    const expectedCount = visibleFields.length * timelineLabels.length;
    return Math.max(0, expectedCount - visibleSlotSummary.total);
  }, [timelineLabels.length, visibleFields.length, visibleSlotSummary.total]);

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setSelectedCellKeys([]);
  }

  function handleVenueChange(nextVenueId: string) {
    setExpandedVenueId(nextVenueId);
    setFieldFilter("all");
    setSelectedCellKeys([]);
  }

  function handleFieldFilterChange(nextFieldId: string) {
    setFieldFilter(nextFieldId);
    setSelectedCellKeys([]);
  }

  function handleCellAction(cellKey: string, cellStatus: "none" | "available" | "blocked" | "booked") {
    if (cellStatus === "none" || cellStatus === "booked") return;
    setSelectedCellKeys((prev) =>
      prev.includes(cellKey) ? prev.filter((key) => key !== cellKey) : [...prev, cellKey]
    );
  }

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
      <div className="slot-page-head">
        <div>
          <h3>Điều phối khung giờ</h3>
          <p className="muted">Chọn ngày, chi nhánh và thao tác trực tiếp trên timeline.</p>
        </div>
        <div className="slot-head-summary">
          <span className="slot-summary-pill">{dateLabel}</span>
          <span className="slot-summary-pill">{selectedVenue ? selectedVenue.name : `${venues.length} chi nhánh`}</span>
          <span className="slot-summary-pill active">{selectedCellKeys.length} ô đã chọn</span>
        </div>
      </div>

      <div className="card slot-control-card">
        <div className="slot-control-top">
          <div>
            <h4>Bộ lọc và thao tác</h4>
            <p className="muted">
              {selectedVenue
                ? `${selectedVenue.name}${selectedVenue.address ? ` · ${selectedVenue.address}` : ""}`
                : "Chọn một chi nhánh để xem timeline và thao tác theo từng sân."}
            </p>
          </div>
          <div className="slot-control-status">
            <span className={`slot-action-pill slot-action-pill-${actionMode}`}>{actionCopy.label}</span>
            <span className="slot-selected-count">{selectedCellKeys.length} ô đã chọn</span>
          </div>
        </div>

        <div className="slot-filter-grid">
          <label className="input-col slot-input-card">
            <span>Ngày vận hành</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                handleDateChange(e.target.value);
              }}
            />
            <small>{dateLabel}</small>
          </label>

          <label className="input-col slot-input-card">
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
            <small>{selectedVenue ? selectedVenue.address : "Đồng bộ với danh sách chi nhánh phía dưới."}</small>
          </label>

          <label className="input-col slot-input-card">
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
            <small>
              {expandedVenueId
                ? `${visibleFields.length}/${fields.length} sân đang hiển thị trong timeline.`
                : "Chọn chi nhánh trước khi lọc theo sân."}
            </small>
          </label>

          <label className="input-col slot-input-card">
            <span>Thao tác hàng loạt</span>
            <select value={actionMode} onChange={(e) => setActionMode(e.target.value as typeof actionMode)}>
              <option value="block">Khóa slot</option>
              <option value="unblock">Mở slot</option>
              <option value="reserve">Đặt giữ slot</option>
            </select>
            <small>{actionCopy.description}</small>
          </label>
        </div>

        <div className="slot-control-footer">
          <div className="slot-shortcut-row">
            <button
              type="button"
              className={`slot-quick-btn ${date === todayValue ? "active" : ""}`}
              onClick={() => handleDateChange(todayValue)}
            >
              Hôm nay
            </button>
            <button
              type="button"
              className={`slot-quick-btn ${date === tomorrowValue ? "active" : ""}`}
              onClick={() => handleDateChange(tomorrowValue)}
            >
              Ngày mai
            </button>
          </div>
          <div className="slot-control-actions">
            {expandedVenueId ? (
              <span className="slot-helper-text">Hiển thị {visibleFields.length} sân trong timeline.</span>
            ) : (
              <span className="slot-helper-text">Chọn chi nhánh để bắt đầu.</span>
            )}
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
        {!expandedVenueId && venues.length ? (
          <div className="slot-feedback slot-feedback-muted">
            Chọn chi nhánh ở bộ lọc phía trên hoặc mở một card bên dưới để xem timeline chi tiết.
          </div>
        ) : null}
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
                        <div className="slot-venue-summary">
                          <span className="slot-stat-chip">{visibleFields.length} sân</span>
                          <span className="slot-stat-chip">{visibleSlotSummary.available} mở</span>
                          <span className="slot-stat-chip">{visibleSlotSummary.blocked} khóa</span>
                          <span className="slot-stat-chip">{visibleSlotSummary.booked} đã đặt</span>
                        </div>

                        <div className="slot-timeline-legend">
                          <span>
                            <i className="legend-dot legend-none" /> Chưa tạo slot
                          </span>
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

                        {missingSlotCount > 0 ? (
                          <p className="slot-empty-note muted">
                            Có {missingSlotCount} ô trong timeline chưa được tạo slot, nên sẽ không thể chọn trực tiếp.
                          </p>
                        ) : null}

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
                                      const cellInfo = slotCellInfoMap.get(cellKey);
                                      const isSelected = selectedCellKeys.includes(cellKey);
                                      const cellStatusClass =
                                        !cellInfo || cellInfo.status === "none"
                                          ? "slot-cell-none"
                                          : cellInfo.status === "blocked"
                                            ? "slot-cell-blocked"
                                            : cellInfo.status === "booked"
                                              ? "slot-cell-booked"
                                              : "slot-cell-available";

                                      return (
                                        <td key={`${field.id}-${label}`}>
                                          <button
                                            className={`slot-cell ${cellStatusClass} ${isSelected ? "slot-cell-selected" : ""}`}
                                            disabled={
                                              !cellInfo ||
                                              cellInfo.status === "none" ||
                                              cellInfo.status === "booked" ||
                                              toggleMutation.isPending
                                            }
                                            onClick={() => handleCellAction(cellKey, cellInfo?.status || "none")}
                                            title={
                                              !cellInfo || cellInfo.status === "none"
                                                ? "Không có slot"
                                                : cellInfo.status === "booked"
                                                  ? `${field.name} · Đã có đơn`
                                                  : cellInfo.status === "blocked"
                                                    ? `${field.name} · Slot đang khóa`
                                                    : `${field.name} · Slot đang mở`
                                            }
                                          >
                                            &nbsp;
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

                        {!slotsQuery.isLoading && visibleSlotSummary.total === 0 ? (
                          <p className="slot-empty-note muted">Ngày này chưa có slot. Hãy Generate cho sân cần mở lịch.</p>
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
    </section>
  );
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

function shiftDateValue(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = next.getUTCFullYear();
  const nextMonth = `${next.getUTCMonth() + 1}`.padStart(2, "0");
  const nextDay = `${next.getUTCDate()}`.padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
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

