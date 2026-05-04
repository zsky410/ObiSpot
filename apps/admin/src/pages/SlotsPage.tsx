import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  type AdminSlot,
  ApiRequestError,
  createBulkSlotsApi,
  getAdminFieldsApi,
  getAdminSlotsApi,
  getVenuesApi,
  patchAdminSlotStatusApi
} from "../lib/api";
import { useAuth } from "../store/auth";

export function SlotsPage() {
  const { getValidAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [venueId, setVenueId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fieldIdForBulk, setFieldIdForBulk] = useState("");

  const venuesQuery = useQuery({
    queryKey: ["venues"],
    queryFn: getVenuesApi
  });

  const slotsQuery = useQuery({
    queryKey: ["admin-slots", date, venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return getAdminSlotsApi(token, date, venueId);
    }
  });

  const fieldsQuery = useQuery({
    queryKey: ["admin-fields", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return getAdminFieldsApi(token, venueId);
    }
  });

  const fields = useMemo(() => fieldsQuery.data?.items || [], [fieldsQuery.data?.items]);

  const toggleMutation = useMutation({
    mutationFn: async (payload: { slotId: string; nextStatus: "available" | "blocked" }) => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return patchAdminSlotStatusApi(token, payload.slotId, payload.nextStatus);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-slots"] })
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      if (!fieldIdForBulk) throw new Error("Vui lòng chọn sân để generate slot.");
      return createBulkSlotsApi(token, {
        fieldId: fieldIdForBulk,
        fromDate: date,
        toDate: date,
        slotMinutes: 90,
        dailyStart: "05:00",
        dailyEnd: "23:00"
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-slots"] })
  });

  const venues = venuesQuery.data?.items || [];
  const slotGroups = useMemo(() => groupSlotsBySession(slotsQuery.data?.items || []), [slotsQuery.data?.items]);

  return (
    <section>
      <div className="filter-row card">
        <label className="input-col">
          <span>Chi nhánh</span>
          <select
            value={venueId}
            onChange={(e) => {
              setVenueId(e.target.value);
              setFieldIdForBulk("");
            }}
          >
            <option value="">-- Chọn chi nhánh --</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="input-col">
          <span>Ngày</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="input-col">
          <span>Sân tạo slot</span>
          <select value={fieldIdForBulk} onChange={(e) => setFieldIdForBulk(e.target.value)} disabled={!venueId}>
            <option value="">-- Chọn sân --</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={() => bulkMutation.mutate()} disabled={!fieldIdForBulk || bulkMutation.isPending}>
          {bulkMutation.isPending ? "Đang tạo..." : "Generate slots"}
        </button>
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

      {slotsQuery.data?.items?.length ? (
        <div className="slot-board card">
          {slotGroups.map((group) => (
            <div key={group.label} className="slot-group">
              <div className="slot-group-title">{group.label}</div>
              <div className="slot-grid">
                {group.items.length === 0 ? <p className="muted">Không có ca</p> : null}
                {group.items.map((slot) => {
                  const nextStatus = slot.status === "available" ? "blocked" : "available";
                  return (
                    <button
                      key={slot.id}
                      className={`slot-chip slot-${slot.status}`}
                      onClick={() => toggleMutation.mutate({ slotId: slot.id, nextStatus })}
                      disabled={toggleMutation.isPending}
                    >
                      <span>{slot.fieldName}</span>
                      <strong>{formatShortRange(slot.startTime, slot.endTime)}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatShortRange(start: string, end: string) {
  const s = new Date(start).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
  const e = new Date(end).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
  return `${s} - ${e}`;
}

function groupSlotsBySession(items: AdminSlot[]) {
  const groups = [
    { label: "Buổi sáng", items: [] as AdminSlot[] },
    { label: "Buổi chiều", items: [] as AdminSlot[] },
    { label: "Buổi tối", items: [] as AdminSlot[] }
  ];

  for (const slot of items) {
    const hour = Number(
      new Date(slot.startTime).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        hour12: false
      })
    );
    if (hour < 12) groups[0].items.push(slot);
    else if (hour < 18) groups[1].items.push(slot);
    else groups[2].items.push(slot);
  }
  return groups;
}
