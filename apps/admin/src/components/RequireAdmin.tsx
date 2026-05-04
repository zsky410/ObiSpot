import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../store/auth";

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { ready, auth } = useAuth();
  const location = useLocation();

  if (!ready) {
    return <div className="center-card">Đang khởi tạo phiên đăng nhập...</div>;
  }
  if (!auth.accessToken || auth.user?.role !== "admin") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
