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

export function SlotsPage() {
  const { getValidAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
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

  const venues = venuesQuery.data?.items || [];
  const visibleFields = useMemo(() => {
    if (fieldFilter === "all") return fields;
    return fields.filter((f) => f.id === fieldFilter);
  }, [fields, fieldFilter]);
  const timelineLabels = useMemo(() => buildTimelineLabels("05:00", "23:00"), []);
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
      for (const p of labelsWithMs) {
        if (!(p.startMs < slotEndMs && slotStartMs < p.endMs)) continue;
        const key = `${slot.fieldId}__${p.label}`;
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

  function handleCellAction(slot: AdminSlot | undefined) {
    if (!slot) return;
    if (slot.status === "booked") return;
    const cellKey = `${slot.fieldId}__${toHm(slot.startTime)}`;
    setSelectedCellKeys((prev) =>
      prev.includes(cellKey) ? prev.filter((k) => k !== cellKey) : [...prev, cellKey]
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
    if (selectedCells.some((c) => c.info.status === "booked")) {
      window.alert("Có slot đã được user đặt. Hãy bỏ chọn các ô này.");
      return;
    }

    if (actionMode === "block") {
      const targetIds = Array.from(
        new Set(selectedCells.flatMap((c) => c.info.availableIds))
      );
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
      const targetIds = Array.from(
        new Set(selectedCells.flatMap((c) => c.info.blockedIds))
      );
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
    // reserve: giữ chỗ thủ công bằng cách khóa slot để app không đặt được.
    const targetIds = Array.from(
      new Set(selectedCells.flatMap((c) => c.info.availableIds))
    );
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
    <section>
      <div className="page-head slot-page-head">
        <h3>Điều phối slot theo chi nhánh</h3>
        <p className="muted">Chọn nhiều ô trực tiếp trên timeline rồi áp dụng thao tác hàng loạt.</p>
      </div>

      <div className="filter-row card slot-control-card">
        <label className="input-col">
          <span>Ngày</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectedCellKeys([]);
            }}
          />
        </label>
        <label className="input-col">
          <span>Lọc sân</span>
          <select
            value={fieldFilter}
            onChange={(e) => {
              setFieldFilter(e.target.value);
              setSelectedCellKeys([]);
            }}
            disabled={!expandedVenueId}
          >
            <option value="all">Tất cả sân</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="input-col">
          <span>Thao tác nhanh</span>
          <select value={actionMode} onChange={(e) => setActionMode(e.target.value as typeof actionMode)}>
            <option value="block">Khóa slot</option>
            <option value="unblock">Mở slot</option>
            <option value="reserve">Đặt giữ slot</option>
          </select>
        </label>
        <button className="btn slot-apply-btn" onClick={applyActionOnSelected} disabled={selectedCellKeys.length === 0 || toggleMutation.isPending}>
          {toggleMutation.isPending ? "Đang cập nhật..." : "Thực hiện"}
        </button>
        <span className="slot-selected-count">Đã chọn: {selectedCellKeys.length} ô</span>
      </div>

      {venuesQuery.isError ? <p className="error">Không tải được danh sách chi nhánh.</p> : null}
      {fieldsQuery.isError ? <p className="error">Không tải được danh sách sân.</p> : null}
      {slotsQuery.isLoading ? <p>Đang tải...</p> : null}
      {slotsQuery.isError ? (
        <p className="error">
          {slotsQuery.error instanceof ApiRequestError || slotsQuery.error instanceof Error
            ? slotsQuery.error.message
            : "Không tải được slots"}
        </p>
      ) : null}

      {venues.length ? (
        <div className="slot-venue-list">
          {venues.map((venue) => {
            const open = expandedVenueId === venue.id;
            return (
              <div key={venue.id} className="card slot-venue-item">
                <button
                  className={`slot-venue-toggle ${open ? "open" : ""}`}
                  onClick={() => {
                    setExpandedVenueId((prev) => (prev === venue.id ? "" : venue.id));
                    setFieldFilter("all");
                    setSelectedCellKeys([]);
                  }}
                >
                  <span>{venue.name}</span>
                  <span>{open ? "▾" : "▸"}</span>
                </button>
                {open ? (
                  <div className="slot-venue-body">
                    <div className="slot-timeline-legend">
                      <span>
                        <i className="legend-dot legend-available" /> Chưa có slot
                      </span>
                      <span>
                        <i className="legend-dot legend-booked" /> Đã có slot
                      </span>
                      <span>
                        <i className="legend-dot legend-selected" /> Đang chọn
                      </span>
                    </div>
                    <div className="slot-timeline-wrap">
                      <table className="slot-timeline-table">
                        <thead>
                          <tr>
                            <th>Giờ</th>
                            {visibleFields.map((f) => (
                              <th key={f.id}>{f.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {timelineLabels.map((label) => (
                            <tr key={label}>
                              <td className="slot-time-col">{label}</td>
                              {visibleFields.map((f) => {
                                const cellKey = `${f.id}__${label}`;
                                const cellInfo = slotCellInfoMap.get(cellKey);
                                const isSelected = selectedCellKeys.includes(cellKey);
                                const cellStatusClass = !cellInfo || cellInfo.status === "none"
                                  ? "slot-cell-none"
                                  : cellInfo.status === "blocked"
                                      ? "slot-cell-blocked"
                                      : "slot-cell-filled";
                                return (
                                  <td key={`${f.id}-${label}`}>
                                    <button
                                      className={`slot-cell ${cellStatusClass} ${isSelected ? "slot-cell-selected" : ""}`}
                                      disabled={!cellInfo || cellInfo.status === "none" || cellInfo.status === "booked" || toggleMutation.isPending}
                                      onClick={() =>
                                        handleCellAction(
                                          cellInfo
                                            ? ({
                                                id: cellInfo.availableIds[0] || cellInfo.blockedIds[0] || cellInfo.bookedIds[0] || "",
                                                fieldId: f.id,
                                                fieldName: f.name,
                                                startTime: `${date}T${label}:00+07:00`,
                                                endTime: `${date}T${label}:00+07:00`,
                                                status: cellInfo.status === "booked" ? "booked" : cellInfo.status === "blocked" ? "blocked" : "available",
                                                bookingStatus: cellInfo.status === "booked" ? "confirmed" : null
                                              } as AdminSlot)
                                            : undefined
                                        )
                                      }
                                      title={
                                        !cellInfo || cellInfo.status === "none"
                                          ? "Không có slot"
                                          : cellInfo.status === "booked"
                                            ? `${f.name} · Đã có đơn`
                                            : cellInfo.status === "blocked"
                                              ? `${f.name} · Slot đang khóa`
                                              : `${f.name} · Slot đang mở`
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
                      {!slotsQuery.isLoading && (slotsQuery.data?.items?.length || 0) === 0 ? (
                        <p className="muted">Ngày này chưa có slot. Hãy Generate cho sân cần mở lịch.</p>
                      ) : null}
                    </div>
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

function boundaryLabelMs(date: string, label: string) {
  return new Date(`${date}T${label}:00+07:00`).getTime();
}

function buildTimelineLabels(startHm: string, endHm: string) {
  const labels: string[] = [];
  const [sh, sm] = startHm.split(":").map(Number);
  const [eh, em] = endHm.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  for (let m = start; m <= end; m += 30) {
    const h = Math.floor(m / 60)
      .toString()
      .padStart(2, "0");
    const mm = (m % 60).toString().padStart(2, "0");
    labels.push(`${h}:${mm}`);
  }
  return labels;
}

function toHm(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
