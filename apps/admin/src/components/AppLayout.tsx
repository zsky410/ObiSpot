import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";

export function AppLayout() {
  const { auth, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const tabTitle =
    location.pathname === "/bookings"
      ? "Đơn đặt sân"
      : location.pathname === "/slots"
        ? "Quản lý khung giờ"
        : "Tổng quan";

  function logout() {
    signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="layout-root">
      <aside className="sidebar panel">
        <div className="brand-block">
          <img src="/obispottext_logo.png" alt="ObiSpot" className="brand-logo" />
          <p className="brand-sub">Field Manager · Operational Hub</p>
        </div>
        <nav className="nav-col">
          <NavLink className="nav-item" to="/dashboard">
            Tổng quan
          </NavLink>
          <NavLink className="nav-item" to="/bookings">
            Đơn đặt sân
          </NavLink>
          <NavLink className="nav-item" to="/slots">
            Quản lý khung giờ
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <button className="btn btn-outline sidebar-logout" onClick={logout}>
            <span className="sidebar-logout-icon" aria-hidden="true">
              ↗
            </span>
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="content panel">
        <header className="topbar">
          <h2 className="topbar-title">{tabTitle}</h2>
          <div className="topbar-actions">
            <input className="search-mini" placeholder="Tìm kiếm nhanh..." />
            <div className="admin-mini top-admin-mini">
              <div className="admin-avatar">{(auth.user?.fullName || "A").slice(0, 1).toUpperCase()}</div>
              <div>
                <p className="admin-name">{auth.user?.fullName || "Admin User"}</p>
                <p className="admin-role">Manager</p>
              </div>
            </div>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
