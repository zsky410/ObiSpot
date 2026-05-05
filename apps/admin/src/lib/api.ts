export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export class ApiRequestError extends Error {
  code?: string;
  details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1").replace(/\/+$/, "");

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  token?: string | null;
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new ApiRequestError(json?.error?.message || "Request failed", json?.error?.code, json?.error?.details);
  }
  return json;
}

export type AuthSessionPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  user: { id: string; fullName: string; role: string };
};

export type AdminDashboard = {
  fromDate: string;
  toDate: string;
  filters: {
    venueId: string | null;
    status: "all" | "pending" | "confirmed" | "cancelled";
  };
  ordersTotal: number;
  revenueTotal: number;
  totalSlots: number;
  slotUtilization: number;
  statusCount: {
    pending: number;
    confirmed: number;
    cancelled: number;
  };
  ordersByDay: Array<{
    date: string;
    orders: number;
    revenue: number;
  }>;
};

export type AdminBooking = {
  id: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string;
  userId: string;
  customerName: string;
  slotId: string;
  slotStartTime: string | null;
  slotEndTime: string | null;
  fieldName: string;
  venueId: string | null;
  venueName?: string;
  venueAddress?: string;
  totalPrice?: number;
  slotCount?: number;
};

export type AdminSlot = {
  id: string;
  fieldId: string;
  fieldName: string;
  startTime: string;
  endTime: string;
  status: "available" | "blocked" | "booked";
  bookingStatus?: "pending" | "confirmed" | null;
};

export type Venue = {
  id: string;
  name: string;
  address: string;
};

export type Field = {
  id: string;
  name: string;
  venueId: string;
};

export async function loginApi(email: string, password: string) {
  return apiRequest<AuthSessionPayload>("/auth/login", { method: "POST", body: { email, password } });
}

export async function refreshSessionApi(refreshToken: string) {
  return apiRequest<AuthSessionPayload>("/auth/refresh", { method: "POST", body: { refreshToken } });
}

export async function getVenuesApi() {
  return apiRequest<{ items: Venue[] }>("/venues");
}

export async function getAdminDashboardApi(
  token: string,
  params?: {
    fromDate?: string;
    toDate?: string;
    venueId?: string;
    status?: "all" | "pending" | "confirmed" | "cancelled";
  }
) {
  const q = new URLSearchParams();
  if (params?.fromDate) q.set("fromDate", params.fromDate);
  if (params?.toDate) q.set("toDate", params.toDate);
  if (params?.venueId) q.set("venueId", params.venueId);
  if (params?.status && params.status !== "all") q.set("status", params.status);
  return apiRequest<AdminDashboard>(`/admin/dashboard${q.size ? `?${q.toString()}` : ""}`, { token });
}

export async function getAdminBookingsApi(token: string, date?: string, status?: string) {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (status && status !== "all") q.set("status", status);
  return apiRequest<{ items: AdminBooking[] }>(`/admin/bookings${q.size ? `?${q.toString()}` : ""}`, { token });
}

export async function patchAdminBookingStatusApi(token: string, bookingId: string, status: "confirmed" | "cancelled") {
  return apiRequest<{ id: string; status: string }>(`/admin/bookings/${bookingId}`, {
    method: "PATCH",
    token,
    body: { status }
  });
}

export async function getAdminSlotsApi(token: string, date: string, venueId: string) {
  const q = new URLSearchParams({ date, venueId });
  return apiRequest<{ items: AdminSlot[] }>(`/admin/slots?${q.toString()}`, { token });
}

export async function getAdminFieldsApi(token: string, venueId: string) {
  const q = new URLSearchParams({ venueId });
  return apiRequest<{ items: Field[] }>(`/admin/fields?${q.toString()}`, { token });
}

export async function patchAdminSlotStatusApi(token: string, slotId: string, status: "available" | "blocked") {
  return apiRequest<{ id: string; status: string }>(`/admin/slots/${slotId}`, {
    method: "PATCH",
    token,
    body: { status }
  });
}

export async function patchAdminSlotsBulkStatusApi(
  token: string,
  payload: { slotIds: string[]; status: "available" | "blocked" }
) {
  return apiRequest<{ updatedCount: number; slotIds: string[]; status: "available" | "blocked" }>(
    "/admin/slots/status/bulk",
    {
      method: "PATCH",
      token,
      body: payload
    }
  );
}

export async function createBulkSlotsApi(
  token: string,
  payload: {
    fieldId: string;
    fromDate: string;
    toDate: string;
    slotMinutes: number;
    dailyStart: string;
    dailyEnd: string;
  }
) {
  return apiRequest<{ createdCount: number; skippedCount: number }>("/admin/slots/bulk", {
    method: "POST",
    token,
    body: payload
  });
}
