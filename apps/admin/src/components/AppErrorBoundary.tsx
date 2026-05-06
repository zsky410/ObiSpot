import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Admin app render error", error, errorInfo);
  }

  reloadPage = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="center-card">
          <div className="card runtime-error-card">
            <h2>Trang quản trị đang gặp lỗi hiển thị</h2>
            <p className="muted">
              Dữ liệu tải về có thể chưa đồng bộ với phiên bản giao diện hiện tại. Hãy tải lại trang sau khi
              backend được cập nhật.
            </p>
            <p className="error">{this.state.error.message || "Đã xảy ra lỗi không xác định."}</p>
            <button className="btn" type="button" onClick={this.reloadPage}>
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
