import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, getAdminBookingsApi, getAdminDashboardApi } from "../lib/api";
import { useAuth } from "../store/auth";

export function DashboardPage() {
  const { getValidAccessToken } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) {
        throw new Error("Phiên đăng nhập đã hết hạn.");
      }
      return getAdminDashboardApi(token);
    }
  });
  const pendingQuery = useQuery({
    queryKey: ["admin-bookings-pending-count"],
    queryFn: async () => {
      const token = await getValidAccessToken();
      if (!token) {
        throw new Error("Phiên đăng nhập đã hết hạn.");
      }
      const data = await getAdminBookingsApi(token, undefined, "pending");
      return data.items.length;
    }
  });

  return (
    <section>
      {dashboardQuery.isLoading ? <p>Đang tải...</p> : null}
      {dashboardQuery.isError ? (
        <p className="error">
          {dashboardQuery.error instanceof ApiRequestError || dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : "Không tải được dashboard"}
        </p>
      ) : null}
      {dashboardQuery.data ? (
        <div className="stat-grid stat-grid-four">
          <div className="card stat-card">
            <h3>Số đơn hôm nay</h3>
            <p className="stat-value">{dashboardQuery.data.bookingsToday}</p>
          </div>
          <div className="card stat-card">
            <h3>Tỉ lệ lấp đầy slot</h3>
            <p className="stat-value">{Math.round(dashboardQuery.data.slotUtilization * 100)}%</p>
            <p className="muted">Tổng slot: {dashboardQuery.data.totalSlotsToday}</p>
          </div>
          <div className="card stat-card">
            <h3>Đơn chờ xác nhận</h3>
            <p className="stat-value">{pendingQuery.data ?? "..."}</p>
          </div>
          <div className="card stat-card">
            <h3>Đơn đã xác nhận</h3>
            <p className="stat-value">{Math.max(dashboardQuery.data.bookingsToday - (pendingQuery.data ?? 0), 0)}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
