import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ApiRequestError,
  getAdminBookingsApi,
  patchAdminBookingCancelRequestApi,
  patchAdminRefundRequestApi,
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
  const markRefundedMutation = useMutation({
    mutationFn: async (args: { refundRequestId: string }) => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      return patchAdminRefundRequestApi(token, args.refundRequestId);
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
                <th>Giờ đặt</th>
                <th>Giá tiền</th>
                <th>Trạng thái</th>
                <th>Thanh toán</th>
                <th>Nhận hoàn</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <BookingRow
                  key={item.id}
                  item={item}
                  loading={updateMutation.isPending || cancelRequestMutation.isPending || markRefundedMutation.isPending}
                  onConfirm={() => updateMutation.mutate({ bookingId: item.id, status: "confirmed" })}
                  onCancel={() => updateMutation.mutate({ bookingId: item.id, status: "cancelled" })}
                  onApproveCancelRequest={() =>
                    cancelRequestMutation.mutate({ bookingId: item.id, decision: "approved" })
                  }
                  onRejectCancelRequest={() =>
                    cancelRequestMutation.mutate({ bookingId: item.id, decision: "rejected" })
                  }
                  onMarkRefunded={() =>
                    item.refundRequest?.id && markRefundedMutation.mutate({ refundRequestId: item.refundRequest.id })
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
  onRejectCancelRequest,
  onMarkRefunded
}: {
  item: AdminBooking;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onApproveCancelRequest: () => void;
  onRejectCancelRequest: () => void;
  onMarkRefunded: () => void;
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
  const paymentLabel =
    item.paymentStatus === "paid"
      ? "Đã thanh toán"
      : item.paymentStatus === "expired"
        ? "Hết hạn"
        : item.paymentStatus === "refunded"
          ? "Đã hoàn"
          : "Chờ thanh toán";
  const refundLabel = item.refundRequest
    ? item.refundRequest.feePercent === 30
      ? "Hoàn 70% (phí 30%)"
      : "Hoàn 100%"
    : null;
  const refundStatusLabel = item.refundRequest ? formatRefundStatus(item.refundRequest.status) : null;
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
        <div className="booking-status-stack">
          <span className="status-badge">{paymentLabel}</span>
          {refundLabel ? <span className="status-badge status-cancel-request">{refundLabel}</span> : null}
        </div>
      </td>
      <td>
        {item.refundRequest ? (
          <div className="booking-status-stack">
            <span className="cell-price">{formatVnd(item.refundRequest.refundAmountVnd)}</span>
            {refundStatusLabel ? <span className="cell-muted">{refundStatusLabel}</span> : null}
            {item.refundRequest.bankAccount ? (
              <>
                <span className="cell-text">{item.refundRequest.bankAccount.bankName}</span>
                <span className="cell-muted cell-code">STK: {item.refundRequest.bankAccount.accountNumber}</span>
                <span className="cell-muted">Người thụ hưởng: {item.refundRequest.bankAccount.accountHolderName}</span>
              </>
            ) : (
              <span className="cell-muted">Khách chưa cung cấp tài khoản nhận hoàn.</span>
            )}
            {item.refundRequest.requestedAt ? (
              <span className="cell-muted">Gửi lúc {formatDateTime(item.refundRequest.requestedAt)}</span>
            ) : null}
          </div>
        ) : (
          <span className="cell-muted">—</span>
        )}
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
            item.refundRequest && item.refundRequest.status !== "refunded" ? (
              <button className="btn-sm btn-sm" onClick={onMarkRefunded} disabled={loading}>
                Xác nhận đã hoàn
              </button>
            ) : (
              <span className="action-state action-state-danger">Đơn đã hủy</span>
            )
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRefundStatus(status: "pending" | "approved" | "rejected" | "refunded") {
  if (status === "approved") return "Hoàn tiền: đã duyệt";
  if (status === "rejected") return "Hoàn tiền: đã từ chối";
  if (status === "refunded") return "Hoàn tiền: đã xong";
  return "Hoàn tiền: chờ xử lý";
}
