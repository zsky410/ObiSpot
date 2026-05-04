import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ApiRequestError,
  getAdminBookingsApi,
  patchAdminBookingStatusApi,
  type AdminBooking
} from "../lib/api";
import { useAuth } from "../store/auth";

type BookingFilterStatus = "all" | "pending" | "confirmed" | "cancelled";

export function BookingsPage() {
  const { getValidAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string>("");
  const [status, setStatus] = useState<BookingFilterStatus>("pending");

  const bookingsQuery = useQuery({
    queryKey: ["admin-bookings", date, status],
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return getAdminBookingsApi(token, date || undefined, status);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (args: { bookingId: string; status: "confirmed" | "cancelled" }) => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return patchAdminBookingStatusApi(token, args.bookingId, args.status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    }
  });

  const rows = useMemo(() => bookingsQuery.data?.items || [], [bookingsQuery.data?.items]);

  return (
    <section>
      <div className="filter-row card">
        <label className="input-col">
          <span>Ngày</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="input-col">
          <span>Trạng thái</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as BookingFilterStatus)}>
            <option value="all">Tất cả</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      {bookingsQuery.isLoading ? <p>Đang tải...</p> : null}
      {bookingsQuery.isError ? (
        <p className="error">
          {bookingsQuery.error instanceof ApiRequestError || bookingsQuery.error instanceof Error
            ? bookingsQuery.error.message
            : "Không tải được bookings"}
        </p>
      ) : null}
      {!bookingsQuery.isLoading && rows.length === 0 ? <p>Không có booking phù hợp bộ lọc.</p> : null}

      {rows.length > 0 ? (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Khách</th>
                <th>Sân</th>
                <th>Giờ</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <BookingRow
                  key={item.id}
                  item={item}
                  loading={updateMutation.isPending}
                  onConfirm={() => updateMutation.mutate({ bookingId: item.id, status: "confirmed" })}
                  onCancel={() => updateMutation.mutate({ bookingId: item.id, status: "cancelled" })}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function BookingRow({
  item,
  loading,
  onConfirm,
  onCancel
}: {
  item: AdminBooking;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const canAct = item.status === "pending" && !loading;
  return (
    <tr>
      <td>#{item.id.slice(0, 8).toUpperCase()}</td>
      <td>{item.customerName || item.userId.slice(0, 8)}</td>
      <td>{item.fieldName || "—"}</td>
      <td>{formatSlotTime(item.slotStartTime, item.slotEndTime)}</td>
      <td>
        <span className={`status-badge status-${item.status}`}>{item.status}</span>
      </td>
      <td>
        <div className="table-actions">
          <button className="btn-sm" onClick={onConfirm} disabled={!canAct}>
            Confirm
          </button>
          <button className="btn-sm btn-sm-muted" onClick={onCancel} disabled={!canAct}>
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function formatSlotTime(start: string | null, end: string | null) {
  if (!start || !end) return "—";
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} - ${e.toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}
