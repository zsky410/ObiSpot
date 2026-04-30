const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:4000/api/v1";

export type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
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
    throw new Error(message);
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
