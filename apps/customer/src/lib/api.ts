import Constants from "expo-constants";
import { Platform } from "react-native";

const DEV_BACKEND_PORT = 4000;

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** Ưu tiên EXPO_PUBLIC_API_BASE_URL nếu có; không set thì trong dev tự lấy IP từ Expo (đổi WiFi không cần sửa tay). */
export function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) {
    return stripTrailingSlash(fromEnv);
  }

  if (Platform.OS === "web") {
    return `http://localhost:${DEV_BACKEND_PORT}/api/v1`;
  }

  if (__DEV__) {
    const host = inferDevBundlerHost();
    if (host && host !== "127.0.0.1" && host !== "localhost") {
      return `http://${host}:${DEV_BACKEND_PORT}/api/v1`;
    }
    if (Platform.OS === "android") {
      return `http://10.0.2.2:${DEV_BACKEND_PORT}/api/v1`;
    }
    return `http://localhost:${DEV_BACKEND_PORT}/api/v1`;
  }

  return `http://localhost:${DEV_BACKEND_PORT}/api/v1`;
}

function inferDevBundlerHost(): string | null {
  const raw =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    (Constants.manifest as { debuggerHost?: string } | null)?.debuggerHost ??
    (Constants.manifest2 as { extra?: { expoGo?: { debuggerHost?: string } } } | null)?.extra?.expoGo?.debuggerHost;

  if (!raw || typeof raw !== "string") {
    return null;
  }
  const host = raw.includes(":") ? raw.split(":")[0] : raw;
  return host.length ? host : null;
}

const API_BASE_URL = resolveApiBaseUrl();

export type ApiError = {
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

export type AuthSessionPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  user: { id: string; fullName: string; role: string };
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  token?: string | null;
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    const message = json?.error?.message || "Request failed";
    throw new ApiRequestError(message, json?.error?.code, json?.error?.details);
  }

  return json;
}

export async function loginApi(email: string, password: string) {
  return apiRequest<AuthSessionPayload>("/auth/login", {
    method: "POST",
    body: { email, password }
  });
}

export async function refreshSessionApi(refreshToken: string) {
  return apiRequest<AuthSessionPayload>("/auth/refresh", {
    method: "POST",
    body: { refreshToken }
  });
}

export type Venue = {
  id: string;
  name: string;
  address: string;
};

export type Slot = {
  id: string;
  fieldId: string;
  fieldName: string;
  pitchFormat?: "5v5" | "7v7";
  startTime: string;
  endTime: string;
  status: "available" | "blocked";
  pricePerSlot: number;
};

/** Khung đã bận (đơn chờ/xác nhận hoặc slot blocked) để khớp lưới 30 phút trên app. */
export type SlotBusyRange = {
  fieldName: string;
  startTime: string;
  endTime: string;
};

export type MyBooking = {
  id: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string | null;
  note: string | null;
  slot: {
    id: string | null;
    startTime: string | null;
    endTime: string | null;
    fieldName: string;
    pricePerSlot: number;
    slotCount?: number;
  };
  venue: {
    id: string | null;
    name: string;
    address: string;
  };
};

export async function getVenuesApi() {
  return apiRequest<{ items: Venue[] }>("/venues");
}

export async function getSlotsApi(date: string, venueId: string, pitchFormat?: "5v5" | "7v7") {
  const q = new URLSearchParams({ date, venueId });
  if (pitchFormat) {
    q.set("pitchFormat", pitchFormat);
  }
  return apiRequest<{ date: string; items: Slot[]; busyRanges?: SlotBusyRange[] }>(`/slots?${q.toString()}`);
}

export async function createBookingApi(token: string, slotIds: string[], note?: string) {
  const body =
    slotIds.length === 1
      ? { slotId: slotIds[0], note: note || null }
      : { slotIds, note: note || null };

  return apiRequest<{
    id: string;
    bookingIds?: string[];
    slotIds?: string[];
    status: "pending" | "confirmed" | "cancelled";
    slotId?: string;
    userId: string;
    createdAt: string;
    rangeStart?: string;
    rangeEnd?: string;
  }>("/bookings", {
    method: "POST",
    token,
    body
  });
}

export async function getMyBookingsApi(token: string) {
  return apiRequest<{ items: MyBooking[] }>("/bookings/me", {
    token
  });
}
