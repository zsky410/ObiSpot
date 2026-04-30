const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:4000/api/v1";

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
  return apiRequest<{
    accessToken: string;
    user: { id: string; fullName: string; role: string };
  }>("/auth/login", {
    method: "POST",
    body: { email, password }
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
  startTime: string;
  endTime: string;
  status: "available" | "blocked";
  pricePerSlot: number;
};

export type MyBooking = {
  id: string;
  status: "pending" | "confirmed" | "cancelled";
  slot: {
    id: string | null;
    startTime: string | null;
    fieldName: string;
  };
};

export async function getVenuesApi() {
  return apiRequest<{ items: Venue[] }>("/venues");
}

export async function getSlotsApi(date: string, venueId: string) {
  return apiRequest<{ date: string; items: Slot[] }>(`/slots?date=${date}&venueId=${venueId}`);
}

export async function createBookingApi(token: string, slotId: string, note?: string) {
  return apiRequest<{
    id: string;
    status: "pending" | "confirmed" | "cancelled";
    slotId: string;
    userId: string;
    createdAt: string;
  }>("/bookings", {
    method: "POST",
    token,
    body: {
      slotId,
      note: note || null
    }
  });
}

export async function getMyBookingsApi(token: string) {
  return apiRequest<{ items: MyBooking[] }>("/bookings/me", {
    token
  });
}
