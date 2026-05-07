import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, getAdminBookingsApi, getAdminDashboardApi, getVenuesApi } from "../lib/api";
import { useAuth } from "../store/auth";

type QuickRange = "7d" | "30d" | "custom";
type DashboardStatus = "all" | "pending" | "confirmed" | "cancelled";

export function DashboardPage() {
  const { getValidAccessToken } = useAuth();
  const navigate = useNavigate();
  const [quickRange, setQuickRange] = useState<QuickRange>("7d");
  const [fromDate, setFromDate] = useState<string>(() => toYmd(offsetDays(-6)));
  const [toDate, setToDate] = useState<string>(() => toYmd(new Date()));
  const [venueId, setVenueId] = useState<string>("all");
  const [status, setStatus] = useState<DashboardStatus>("all");

  const venuesQuery = useQuery({
    queryKey: ["admin-venues"],
    queryFn: async () => getVenuesApi()
  });

  const dashboardQuery = useQuery({
    queryKey: ["admin-dashboard", fromDate, toDate, venueId, status],
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) {
        throw new Error("Phiên đăng nhập đã hết hạn.");
      }
      return getAdminDashboardApi(token, {
        fromDate,
        toDate,
        venueId: venueId === "all" ? undefined : venueId,
        status
      });
    }
  });

  const recentBookingsQuery = useQuery({
    queryKey: ["admin-bookings-recent", fromDate, toDate, venueId, status],
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Phiên đăng nhập đã hết hạn.");
      const data = await getAdminBookingsApi(token, undefined, status);
      const inRange = data.items.filter((item) => {
        const d = item.createdAt?.slice(0, 10);
        if (!d) return false;
        return d >= fromDate && d <= toDate;
      });
      const byVenue = venueId === "all" ? inRange : inRange.filter((item) => item.venueId === venueId);
      return byVenue.slice(0, 6);
    }
  });

  const ordersByDay = dashboardQuery.data?.ordersByDay || [];

  const trendDeltaPercent = useMemo(() => {
    const rows = ordersByDay;
    if (rows.length < 2) return 0;
    const mid = Math.floor(rows.length / 2);
    const first = rows.slice(0, mid).reduce((sum, r) => sum + r.orders, 0);
    const second = rows.slice(mid).reduce((sum, r) => sum + r.orders, 0);
    if (first === 0) return second > 0 ? 100 : 0;
    return Math.round(((second - first) / first) * 100);
  }, [ordersByDay]);

  const dashboardInsights = useMemo(() => {
    const data = dashboardQuery.data;
    if (!data) {
      return {
        confirmedPercent: 0,
        pendingPercent: 0,
        cancelledPercent: 0,
        donutStyle: { background: "#edf2f8" },
        statusBreakdown: [],
        averageOrdersPerDay: 0,
        averageRevenuePerConfirmed: 0,
        busiestDay: null as { date: string; orders: number; revenue: number } | null,
        bestRevenueDay: null as { date: string; orders: number; revenue: number } | null
      };
    }

    const totalOrders = Math.max(data.ordersTotal, 0);
    const confirmed = Math.max(data.statusCount.confirmed, 0);
    const pending = Math.max(data.statusCount.pending, 0);
    const cancelled = Math.max(data.statusCount.cancelled, 0);
    const safeTotal = totalOrders || 1;
    const confirmedPercent = Math.round((confirmed / safeTotal) * 100);
    const pendingPercent = Math.round((pending / safeTotal) * 100);
    const cancelledPercent = Math.max(0, 100 - confirmedPercent - pendingPercent);

    const confirmedAngle = confirmedPercent * 3.6;
    const pendingAngle = pendingPercent * 3.6;
    const donutStyle =
      totalOrders === 0
        ? { background: "#edf2f8" }
        : {
            background: `conic-gradient(#0a8f61 0deg ${confirmedAngle}deg, #d6a43f ${confirmedAngle}deg ${
              confirmedAngle + pendingAngle
            }deg, #cb4b4b ${confirmedAngle + pendingAngle}deg 360deg)`
          };

    const statusBreakdown = [
      {
        key: "confirmed",
        label: "Đã xác nhận",
        count: confirmed,
        percent: confirmedPercent,
        progressClassName: "status-progress-confirmed"
      },
      {
        key: "pending",
        label: "Chờ xử lý",
        count: pending,
        percent: pendingPercent,
        progressClassName: "status-progress-pending"
      },
      {
        key: "cancelled",
        label: "Đã huỷ",
        count: cancelled,
        percent: cancelledPercent,
        progressClassName: "status-progress-cancelled"
      }
    ];

    const averageOrdersPerDay =
      ordersByDay.length > 0 ? Number((ordersByDay.reduce((sum, row) => sum + row.orders, 0) / ordersByDay.length).toFixed(1)) : 0;
    const averageRevenuePerConfirmed = confirmed > 0 ? data.revenueTotal / confirmed : 0;
    const busiestDay = ordersByDay.reduce<{ date: string; orders: number; revenue: number } | null>(
      (best, row) => (!best || row.orders > best.orders ? row : best),
      null
    );
    const bestRevenueDay = ordersByDay.reduce<{ date: string; orders: number; revenue: number } | null>(
      (best, row) => (!best || row.revenue > best.revenue ? row : best),
      null
    );

    return {
      confirmedPercent,
      pendingPercent,
      cancelledPercent,
      donutStyle,
      statusBreakdown,
      averageOrdersPerDay,
      averageRevenuePerConfirmed,
      busiestDay,
      bestRevenueDay
    };
  }, [dashboardQuery.data, ordersByDay]);

  const maxDailyOrders = useMemo(() => {
    const rows = dashboardQuery.data?.ordersByDay || [];
    return rows.reduce((max, row) => Math.max(max, row.orders), 0);
  }, [dashboardQuery.data?.ordersByDay]);

  return (
    <section>
      <div className="card dashboard-filters-card">
        <div className="dashboard-filters-meta">
          <div>
            <p className="dashboard-section-kicker">Bộ lọc báo cáo</p>
            <h3>Xem số liệu theo chi nhánh và trạng thái đơn</h3>
          </div>
          <div className="dashboard-range-pill">
            {formatDisplayDate(fromDate)} - {formatDisplayDate(toDate)}
          </div>
        </div>
        <div className="dashboard-filters-row">
          <div className="quick-range-group">
            <button
              className={`btn-sm ${quickRange === "7d" ? "" : "btn-sm-muted"}`}
              onClick={() => {
                setQuickRange("7d");
                setFromDate(toYmd(offsetDays(-6)));
                setToDate(toYmd(new Date()));
              }}
            >
              7 ngày
            </button>
            <button
              className={`btn-sm ${quickRange === "30d" ? "" : "btn-sm-muted"}`}
              onClick={() => {
                setQuickRange("30d");
                setFromDate(toYmd(offsetDays(-29)));
                setToDate(toYmd(new Date()));
              }}
            >
              30 ngày
            </button>
            <button
              className={`btn-sm ${quickRange === "custom" ? "" : "btn-sm-muted"}`}
              onClick={() => setQuickRange("custom")}
            >
              Tuỳ chỉnh
            </button>
          </div>

          <div className="dashboard-filter-inputs">
            <label className="input-col input-col-compact">
              <span>Từ ngày</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setQuickRange("custom");
                  setFromDate(e.target.value);
                }}
              />
            </label>
            <label className="input-col input-col-compact">
              <span>Đến ngày</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setQuickRange("custom");
                  setToDate(e.target.value);
                }}
              />
            </label>
            <label className="input-col input-col-compact">
              <span>Chi nhánh</span>
              <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="all">Tất cả chi nhánh</option>
                {(venuesQuery.data?.items || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="input-col input-col-compact">
              <span>Trạng thái đơn</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as DashboardStatus)}>
                <option value="all">Tất cả</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {dashboardQuery.isLoading ? <p>Đang tải...</p> : null}
      {dashboardQuery.isError ? (
        <p className="error">
          {dashboardQuery.error instanceof ApiRequestError || dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : "Không tải được dashboard"}
        </p>
      ) : null}
      {dashboardQuery.data ? (
        <>
          <div className="stat-grid stat-grid-four">
            <div className="card stat-card">
              <div className="stat-card-head">
                <h3>Tổng đơn</h3>
                <span className="stat-chip">{quickRange === "custom" ? "Tuỳ chỉnh" : quickRange === "30d" ? "30 ngày" : "7 ngày"}</span>
              </div>
              <p className="stat-value">{dashboardQuery.data.ordersTotal}</p>
              <p className="stat-detail">
                Trung bình {dashboardInsights.averageOrdersPerDay} đơn/ngày trong giai đoạn đã chọn
              </p>
            </div>
            <div className="card stat-card">
              <div className="stat-card-head">
                <h3>Doanh thu xác nhận</h3>
                <span className={`stat-chip ${trendDeltaPercent >= 0 ? "stat-chip-positive" : "stat-chip-negative"}`}>
                  {trendDeltaPercent >= 0 ? "+" : ""}
                  {trendDeltaPercent}%
                </span>
              </div>
              <p className="stat-value stat-value-money">{formatVnd(dashboardQuery.data.revenueTotal)}</p>
              <p className="stat-detail">
                Giá trị trung bình mỗi đơn xác nhận: {formatVnd(dashboardInsights.averageRevenuePerConfirmed)}
              </p>
            </div>
            <div className="card stat-card">
              <div className="stat-card-head">
                <h3>Tỉ lệ lấp đầy slot</h3>
                <span className="stat-chip stat-chip-neutral">Capacity</span>
              </div>
              <p className="stat-value">{Math.round(dashboardQuery.data.slotUtilization * 100)}%</p>
              <p className="stat-detail">Tổng slot đang theo dõi: {dashboardQuery.data.totalSlots}</p>
            </div>
            <div className="card stat-card">
              <div className="stat-card-head">
                <h3>Đơn chờ xử lý</h3>
                <span className="stat-chip stat-chip-warning">Needs action</span>
              </div>
              <p className="stat-value">{dashboardQuery.data.statusCount.pending}</p>
              <p className="stat-detail">
                Đã huỷ {dashboardQuery.data.statusCount.cancelled} đơn trong cùng kỳ lọc
              </p>
            </div>
          </div>

          <div className="dashboard-chart-grid dashboard-chart-grid-main">
            <div className="card dashboard-table-card">
              <div className="chart-head chart-head-row">
                <div>
                  <h3>Giao dịch gần đây</h3>
                </div>
                <button className="link-btn" onClick={() => navigate("/bookings")}>
                  Xem tất cả
                </button>
              </div>
              <div className="dashboard-table-wrap">
                <table className="dashboard-data-table">
                  <thead>
                    <tr>
                      <th>Mã đơn</th>
                      <th>Khách hàng</th>
                      <th>Sân / Khung giờ</th>
                      <th>Trạng thái</th>
                      <th>Tổng tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recentBookingsQuery.data || []).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="dashboard-cell-stack">
                            <span className="dashboard-cell-title dashboard-cell-code">#{item.id.slice(0, 8).toUpperCase()}</span>
                            <span className="dashboard-cell-sub">{formatDateTimeLabel(item.createdAt)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-cell-stack">
                            <span className="dashboard-cell-title">{item.customerName || "Khách vãng lai"}</span>
                            <span className="dashboard-cell-sub">{item.venueName || "Chưa gắn chi nhánh"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-cell-stack">
                            <span className="dashboard-cell-title">{item.fieldName || "—"}</span>
                            <span className="dashboard-cell-sub">
                              {formatHm(item.slotStartTime)} - {formatHm(item.slotEndTime)} · {item.slotCount || 1} slot
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-status-stack">
                            <span className={`status-badge status-${item.status}`}>{formatBookingStatus(item.status)}</span>
                            <span className="dashboard-cell-sub">
                              Thanh toán: {formatPaymentStatus(item.paymentStatus)}
                            </span>
                          </div>
                        </td>
                        <td className="dashboard-total-cell">{formatVnd(Number(item.totalPrice || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card dashboard-showcase-card">
              <div className="chart-head chart-head-row chart-head-showcase">
                <div>
                  <h3>Phân bổ trạng thái đơn</h3>
                </div>
                <span className="showcase-chip">Tổng {dashboardQuery.data.ordersTotal} đơn</span>
              </div>

              <div className="status-showcase-grid">
                <div className="status-donut-wrap">
                  <div className="status-donut" style={dashboardInsights.donutStyle}>
                    <div className="status-donut-core">
                      <strong>{dashboardInsights.confirmedPercent}%</strong>
                      <span>đã xác nhận</span>
                    </div>
                  </div>
                </div>

                <div className="status-bars">
                  {dashboardInsights.statusBreakdown.map((item) => (
                    <div key={item.key} className="status-bar-row">
                      <div className="status-bar-head">
                        <span>{item.label}</span>
                        <span>
                          {item.count} đơn · {item.percent}%
                        </span>
                      </div>
                      <div className="status-progress">
                        <div
                          className={`status-progress-inner ${item.progressClassName}`}
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="showcase-insights-grid">
                <div className="showcase-insight-card">
                  <span>Nhịp trung bình</span>
                  <strong>{dashboardInsights.averageOrdersPerDay} đơn/ngày</strong>
                </div>
                <div className="showcase-insight-card">
                  <span>Ngày nhiều đơn nhất</span>
                  <strong>
                    {dashboardInsights.busiestDay ? `${dashboardInsights.busiestDay.orders} đơn` : "0 đơn"}
                  </strong>
                  <small className="showcase-insight-date">
                    {dashboardInsights.busiestDay ? formatDisplayDate(dashboardInsights.busiestDay.date) : "Chưa có dữ liệu"}
                  </small>
                </div>
                <div className="showcase-insight-card">
                  <span>Ngày doanh thu cao nhất</span>
                  <strong>
                    {dashboardInsights.bestRevenueDay ? formatVnd(dashboardInsights.bestRevenueDay.revenue) : formatVnd(0)}
                  </strong>
                  <small className="showcase-insight-date">
                    {dashboardInsights.bestRevenueDay
                      ? formatDisplayDate(dashboardInsights.bestRevenueDay.date)
                      : "Chưa có dữ liệu"}
                  </small>
                </div>
              </div>

              <div className="mini-activity-strip">
                {(ordersByDay || []).slice(-7).map((row, idx) => (
                  <div key={row.date} className="mini-activity-item" title={`${row.date} • ${row.orders} đơn`}>
                    <span
                      className={`mini-activity-bar ${row.orders === maxDailyOrders ? "mini-activity-bar-peak" : ""}`}
                      style={{
                        height: `${scaledBarHeight(row.orders, maxDailyOrders, 62, 10)}px`,
                        animationDelay: `${idx * 80}ms`
                      }}
                    />
                    <small>{formatCompactDate(row.date)}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function offsetDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

function formatHm(iso: string | null) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return d.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
}

function formatDisplayDate(value: string) {
  const date = new Date(`${value}T00:00:00+07:00`);
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCompactDate(value: string) {
  const date = new Date(`${value}T00:00:00+07:00`);
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function formatDateTimeLabel(value: string | null | undefined) {
  if (!value) return "Chưa có thời gian";
  const date = new Date(value);
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBookingStatus(status: DashboardStatus | "confirmed" | "cancelled") {
  if (status === "pending") return "Chờ xử lý";
  if (status === "confirmed") return "Đã xác nhận";
  if (status === "cancelled") return "Đã huỷ";
  return "Tất cả";
}

function formatPaymentStatus(status: string | undefined) {
  if (status === "paid") return "Đã thanh toán";
  if (status === "awaiting") return "Chờ thanh toán";
  if (status === "expired") return "Hết hạn";
  if (status === "refunded") return "Đã hoàn tiền";
  return "Chưa rõ";
}

function scaledBarHeight(value: number, max: number, maxHeight: number, minHeight = 6) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) return 0;
  const ratio = Math.sqrt(value / max);
  return Math.max(minHeight, Math.round(ratio * maxHeight));
}
