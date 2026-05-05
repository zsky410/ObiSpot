import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, getAdminBookingsApi, getAdminDashboardApi, getVenuesApi } from "../lib/api";
import { useAuth } from "../store/auth";

type QuickRange = "7d" | "30d" | "custom";
type DashboardStatus = "all" | "pending" | "confirmed" | "cancelled";

export function DashboardPage() {
  const { getValidAccessToken } = useAuth();
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

  const maxDailyOrders = useMemo(() => {
    const rows = dashboardQuery.data?.ordersByDay || [];
    return rows.reduce((max, row) => Math.max(max, row.orders), 0);
  }, [dashboardQuery.data?.ordersByDay]);

  const trendDeltaPercent = useMemo(() => {
    const rows = dashboardQuery.data?.ordersByDay || [];
    if (rows.length < 2) return 0;
    const mid = Math.floor(rows.length / 2);
    const first = rows.slice(0, mid).reduce((sum, r) => sum + r.orders, 0);
    const second = rows.slice(mid).reduce((sum, r) => sum + r.orders, 0);
    if (first === 0) return second > 0 ? 100 : 0;
    return Math.round(((second - first) / first) * 100);
  }, [dashboardQuery.data?.ordersByDay]);

  return (
    <section>
      <div className="card dashboard-filters-card">
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
              <h3>Tổng đơn</h3>
              <p className="stat-value">{dashboardQuery.data.ordersTotal}</p>
              <p className="muted">Từ {dashboardQuery.data.fromDate}</p>
            </div>
            <div className="card stat-card">
              <h3>Doanh thu xác nhận</h3>
              <p className="stat-value stat-value-money">{formatVnd(dashboardQuery.data.revenueTotal)}</p>
              <p className="muted">{trendDeltaPercent >= 0 ? "▲" : "▼"} {Math.abs(trendDeltaPercent)}% so với kỳ trước</p>
            </div>
            <div className="card stat-card">
              <h3>Tỉ lệ lấp đầy slot</h3>
              <p className="stat-value">{Math.round(dashboardQuery.data.slotUtilization * 100)}%</p>
              <p className="muted">Tổng slot: {dashboardQuery.data.totalSlots}</p>
            </div>
            <div className="card stat-card">
              <h3>Đơn chờ xử lý</h3>
              <p className="stat-value">{dashboardQuery.data.statusCount.pending}</p>
            </div>
          </div>

          <div className="dashboard-chart-grid dashboard-chart-grid-main">
            <div className="card dashboard-table-card">
              <div className="chart-head chart-head-row">
                <h3>Giao dịch gần đây</h3>
                <button className="link-btn">Xem tất cả</button>
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
                        <td>#{item.id.slice(0, 8).toUpperCase()}</td>
                        <td>{item.customerName || "Khách vãng lai"}</td>
                        <td>
                          {item.fieldName || "—"} · {formatHm(item.slotStartTime)} - {formatHm(item.slotEndTime)}
                        </td>
                        <td>
                          <span className={`status-badge status-${item.status}`}>{item.status}</span>
                        </td>
                        <td>{formatVnd(Number(item.totalPrice || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card dashboard-chart-card">
              <div className="chart-head">
                <h3>Xu hướng đặt sân</h3>
              </div>
              <div className="trend-strip">
                {(dashboardQuery.data.ordersByDay || []).slice(-7).map((row, idx) => (
                  <div key={row.date} className="trend-item" title={`${row.date} • ${row.orders} đơn`}>
                    <div
                      className={`trend-bar trend-bar-animated trend-bar-tone-${idx + 1} ${
                        row.orders === maxDailyOrders ? "trend-bar-peak" : ""
                      }`}
                      style={{
                        height: `${scaledBarHeight(row.orders, maxDailyOrders, 118, 28)}px`,
                        animationDelay: `${idx * 90}ms`
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="trend-meta">
                <span className="trend-meta-label">TUẦN NÀY</span>
                <span className={`trend-meta-delta ${trendDeltaPercent >= 0 ? "up" : "down"}`}>
                  {trendDeltaPercent >= 0 ? "+" : ""}
                  {trendDeltaPercent}% SO VỚI TUẦN TRƯỚC
                </span>
              </div>
              <p className="trend-note">
                Khung giờ cao điểm thường rơi vào 18:00–20:00. Nên chuẩn bị nhân sự sớm để xử lý đơn chờ.
              </p>
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

function scaledBarHeight(value: number, max: number, maxHeight: number, minHeight = 6) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) return 0;
  const ratio = Math.sqrt(value / max);
  return Math.max(minHeight, Math.round(ratio * maxHeight));
}
