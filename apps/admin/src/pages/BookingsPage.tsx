import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ApiRequestError,
  getAdminBookingsApi,
  patchAdminBookingCancelRequestApi,
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
  const cancelRequestMutation = useMutation({
    mutationFn: async (args: { bookingId: string; decision: "approved" | "rejected" }) => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return patchAdminBookingCancelRequestApi(token, args.bookingId, args.decision);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin-slots"] });
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
                <th>Giờ đặt</th>
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
                  loading={updateMutation.isPending || cancelRequestMutation.isPending}
                  onConfirm={() => updateMutation.mutate({ bookingId: item.id, status: "confirmed" })}
                  onCancel={() => updateMutation.mutate({ bookingId: item.id, status: "cancelled" })}
                  onApproveCancelRequest={() =>
                    cancelRequestMutation.mutate({ bookingId: item.id, decision: "approved" })
                  }
                  onRejectCancelRequest={() =>
                    cancelRequestMutation.mutate({ bookingId: item.id, decision: "rejected" })
                  }
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
  onCancel,
  onApproveCancelRequest,
  onRejectCancelRequest
}: {
  item: AdminBooking;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onApproveCancelRequest: () => void;
  onRejectCancelRequest: () => void;
}) {
  const cancelRequest = item.cancelRequest ?? { status: null, requestedAt: null, note: null };
  const hasPendingCancelRequest = cancelRequest.status === "pending";
  const canAct = item.status === "pending" && !loading && !hasPendingCancelRequest;
  const canReviewCancelRequest = hasPendingCancelRequest && !loading;
  const statusBadgeClassName = hasPendingCancelRequest ? "status-cancel-request" : `status-${item.status}`;
  const statusBadgeLabel = hasPendingCancelRequest
    ? "Yêu cầu hủy"
    : item.status === "pending"
      ? "Chờ xác nhận"
      : item.status === "confirmed"
        ? "Đã xác nhận"
        : "Đã hủy";
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
        </div>
      </td>
      <td>
        <span className="cell-time">{formatBookingTime(item.slotStartTime, item.slotEndTime)}</span>
      </td>
      <td>
        <span className="cell-price">{formatVnd(item.totalPrice ?? 0)}</span>
      </td>
      <td>
        <div className="booking-status-stack">
          <span className={`status-badge ${statusBadgeClassName}`}>{statusBadgeLabel}</span>
        </div>
      </td>
      <td>
        <div className="table-actions">
          {hasPendingCancelRequest ? (
            <>
              <button className="btn-sm btn-sm-danger" onClick={onApproveCancelRequest} disabled={!canReviewCancelRequest}>
                Duyệt hủy
              </button>
              <button className="btn-sm btn-sm-muted" onClick={onRejectCancelRequest} disabled={!canReviewCancelRequest}>
                Từ chối
              </button>
            </>
          ) : item.status === "pending" ? (
            <>
              <button className="btn-sm" onClick={onConfirm} disabled={!canAct}>
                Xác nhận
              </button>
              <button className="btn-sm btn-sm-muted" onClick={onCancel} disabled={!canAct}>
                Hủy đơn
              </button>
            </>
          ) : item.status === "confirmed" ? (
            <span className="action-state action-state-success">Đã xác nhận</span>
          ) : (
            <span className="action-state action-state-danger">Đơn đã hủy</span>
          )}
        </div>
      </td>
    </tr>
  );
}

function formatBookingTime(start: string | null, end: string | null) {
  if (!start || !end) return "—";
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
  return `${timeRange} · ${date}`;
}

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND"
  }).format(Number.isFinite(value) ? value : 0);
}
