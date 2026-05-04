import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";

export function LoginPage() {
  const { signIn, auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("admin@obispot.demo");
  const [password, setPassword] = useState("admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (auth.accessToken && auth.user?.role === "admin") {
      navigate("/dashboard", { replace: true });
    }
  }, [auth.accessToken, auth.user?.role, navigate]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      const to = (location.state as { from?: string } | null)?.from || "/dashboard";
      navigate(to, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-shell">
        <form className="auth-card" onSubmit={onSubmit}>
          <img src="/obispottext_logo.png" alt="ObiSpot" className="auth-logo" />
          <h1>Đăng nhập</h1>
          <p className="muted">Vui lòng đăng nhập để quản lý hệ thống sân bóng.</p>
          <label className="input-col">
            <span>Tài khoản / Số điện thoại</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label className="input-col">
            <span>Mật khẩu</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
          </label>
          <div className="auth-meta">
            <label className="remember-check">
              <input type="checkbox" defaultChecked />
              <span>Ghi nhớ đăng nhập</span>
            </label>
            <button className="link-btn" type="button">
              Quên mật khẩu?
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn auth-submit" type="submit" disabled={loading}>
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
        <div className="auth-hero">
          <img src="/login-hero.jpg" alt="Sân bóng" />
          <div className="hero-glass">
            <h3>Hệ thống quản lý chuyên nghiệp</h3>
            <p>Tối ưu lịch đặt, quản lý sân và theo dõi vận hành chính xác cho từng chi nhánh.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
