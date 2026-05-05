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
  const [status, setStatus] = useState<BookingFilterStatus>("all");

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
      <div className="card bookings-card">
        <div className="bookings-toolbar">
          <div className="bookings-toolbar-left">
            <h3>Đơn đặt sân</h3>
            <p className="muted">Theo dõi và xử lý trạng thái booking theo thời gian thực.</p>
          </div>
          <div className="bookings-filters">
            <label className="input-col input-col-compact">
              <span>Ngày</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="input-col input-col-compact">
              <span>Trạng thái</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as BookingFilterStatus)}>
                <option value="all">Tất cả</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
        </div>
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
        <div className="table-wrap card bookings-table-card">
          <table className="bookings-data-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Khách</th>
                <th>Sân</th>
                <th>Chi nhánh</th>
                <th>Khung giờ</th>
                <th>Tạo lúc</th>
                <th>Giá tiền</th>
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
      <td>
        <div className="booking-id-cell">
          <span className="cell-em">#{item.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </td>
      <td>
        <div className="booking-user-cell">
          <span className="cell-text">{item.customerName || `Khách ${item.userId.slice(0, 8)}`}</span>
        </div>
      </td>
      <td>
        <div className="booking-field-cell">
          <span className="cell-text">
            {item.fieldName || "—"}
          </span>
        </div>
      </td>
      <td>
        <div className="booking-field-cell">
          <span className="cell-text">{item.venueName || "—"}</span>
          <span className="cell-muted">
            {item.venueAddress || (item.venueId ? `ID: ${item.venueId.slice(0, 8)}` : "—")}
          </span>
        </div>
      </td>
      <td>
        {(() => {
          const slotDisplay = formatSlotTime(item.slotStartTime, item.slotEndTime);
          return (
            <div className="booking-time-cell">
              <span className="cell-time">{slotDisplay.timeRange}</span>
              <span className="cell-muted">{slotDisplay.date}</span>
            </div>
          );
        })()}
      </td>
      <td>
        {(() => {
          const createdDisplay = formatCreatedAt(item.createdAt);
          return (
            <div className="booking-time-cell">
              <span className="cell-time">{createdDisplay.time}</span>
              <span className="cell-muted">{createdDisplay.date}</span>
            </div>
          );
        })()}
      </td>
      <td>
        <span className="cell-price">{formatVnd(item.totalPrice ?? 0)}</span>
      </td>
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
  if (!start || !end) return { timeRange: "—", date: "—" };
  const s = new Date(start);
  const e = new Date(end);
  const timeRange = `${s.toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit"
  })} - ${e.toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
  const date = s.toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  return { timeRange, date };
}

function formatCreatedAt(iso: string) {
  if (!iso) return { time: "—", date: "—" };
  const d = new Date(iso);
  const time = d.toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit"
  });
  const date = d.toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  return { time, date };
}

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND"
  }).format(Number.isFinite(value) ? value : 0);
}
