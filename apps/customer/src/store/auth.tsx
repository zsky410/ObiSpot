import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { loginApi, refreshSessionApi, type AuthSessionPayload } from "../lib/api";

const AUTH_STORAGE_KEY = "obispot_auth_session";
const AUTH_STORAGE_FALLBACK_KEY = "obispot_auth_session_fallback";
const TOKEN_REFRESH_SKEW_MS = 60_000;
let volatileFallbackSession: string | null = null;

type AuthUser = {
  id: string;
  fullName: string;
  role: string;
};

type StoredAuthSession = {
  token: string;
  refreshToken: string;
  expiresAt: number | null;
  user: AuthUser;
};

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
  bootstrapped: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  getValidAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function shouldRefreshToken(expiresAt: number | null) {
  if (!expiresAt) {
    return true;
  }
  return expiresAt * 1000 <= Date.now() + TOKEN_REFRESH_SKEW_MS;
}

function toStoredSession(payload: AuthSessionPayload): StoredAuthSession {
  return {
    token: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: payload.expiresAt,
    user: payload.user
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    refreshToken: null,
    expiresAt: null,
    user: null,
    bootstrapped: false
  });
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  const sessionRef = useRef<StoredAuthSession | null>(null);

  async function removeFallbackStorage() {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(AUTH_STORAGE_FALLBACK_KEY);
      }
      volatileFallbackSession = null;
      return;
    }
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_FALLBACK_KEY);
      volatileFallbackSession = null;
    } catch {
      volatileFallbackSession = null;
    }
  }

  async function setFallbackStorage(rawValue: string) {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(AUTH_STORAGE_FALLBACK_KEY, rawValue);
      } else {
        volatileFallbackSession = rawValue;
      }
      return;
    }
    try {
      await AsyncStorage.setItem(AUTH_STORAGE_FALLBACK_KEY, rawValue);
    } catch {
      volatileFallbackSession = rawValue;
    }
  }

  async function getFallbackStorage() {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(AUTH_STORAGE_FALLBACK_KEY);
      }
      return volatileFallbackSession;
    }
    try {
      const value = await AsyncStorage.getItem(AUTH_STORAGE_FALLBACK_KEY);
      if (value) {
        return value;
      }
    } catch {
      // AsyncStorage native module unavailable -> dùng fallback in-memory.
    }
    return volatileFallbackSession;
  }

  async function writeSessionToStorage(rawValue: string | null) {
    if (rawValue == null) {
      await Promise.allSettled([
        removeFallbackStorage(),
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEY)
      ]);
      return;
    }

    volatileFallbackSession = rawValue;
    try {
      await setFallbackStorage(rawValue);
    } catch {
      volatileFallbackSession = rawValue;
    }

    try {
      await SecureStore.setItemAsync(AUTH_STORAGE_KEY, rawValue);
    } catch {
      // SecureStore là lớp bổ sung. AsyncStorage vẫn giữ phiên để app không tự logout sau reload.
    }
  }

  async function readSessionFromStorage() {
    const fallbackValue = await getFallbackStorage();
    if (fallbackValue) {
      return fallbackValue;
    }

    try {
      const secureValue = await SecureStore.getItemAsync(AUTH_STORAGE_KEY);
      if (secureValue) {
        await setFallbackStorage(secureValue);
        return secureValue;
      }
    } catch {
      // Bỏ qua lỗi SecureStore và thử fallback.
    }
    return null;
  }

  async function persistSession(session: StoredAuthSession | null) {
    await writeSessionToStorage(session ? JSON.stringify(session) : null);
  }

  function setSessionState(session: StoredAuthSession | null, bootstrapped = true) {
    sessionRef.current = session;
    setState({
      token: session?.token ?? null,
      refreshToken: session?.refreshToken ?? null,
      expiresAt: session?.expiresAt ?? null,
      user: session?.user ?? null,
      bootstrapped
    });
  }

  async function replaceSession(session: StoredAuthSession | null, bootstrapped = true) {
    await persistSession(session);
    setSessionState(session, bootstrapped);
  }

  async function refreshWithToken(refreshToken: string) {
    const result = await refreshSessionApi(refreshToken);
    const nextSession = toStoredSession(result);
    await replaceSession(nextSession);
    return nextSession.token;
  }

  useEffect(() => {
    let mounted = true;
    async function restoreSession() {
      try {
        const raw = await readSessionFromStorage();
        if (!mounted) {
          return;
        }

        if (!raw) {
          setSessionState(null);
          return;
        }

        const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;
        if (!parsed.token || !parsed.refreshToken || !parsed.user) {
          await persistSession(null);
          if (mounted) {
            setSessionState(null);
          }
          return;
        }

        const storedSession: StoredAuthSession = {
          token: parsed.token,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt ?? null,
          user: parsed.user
        };

        setSessionState(storedSession);
        if (!shouldRefreshToken(storedSession.expiresAt)) {
          return;
        }

        try {
          const refreshed = await refreshSessionApi(storedSession.refreshToken);
          if (!mounted) {
            return;
          }
          const nextSession = toStoredSession(refreshed);
          await persistSession(nextSession);
          if (mounted) {
            setSessionState(nextSession);
          }
        } catch {
          // Giữ phiên đã lưu để app vẫn vào được; token sẽ được refresh lại khi user thao tác tiếp.
        }
      } catch {
        if (mounted) {
          setSessionState(null);
        }
      }
    }

    restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      async signIn(email: string, password: string) {
        const result = await loginApi(email, password);
        await replaceSession(toStoredSession(result));
      },
      async signOut() {
        refreshPromiseRef.current = null;
        await replaceSession(null);
      },
      async getValidAccessToken() {
        const currentSession = sessionRef.current;
        if (!currentSession?.token || !currentSession.refreshToken) {
          return null;
        }

        if (!shouldRefreshToken(currentSession.expiresAt)) {
          return currentSession.token;
        }

        if (!refreshPromiseRef.current) {
          refreshPromiseRef.current = refreshWithToken(currentSession.refreshToken)
            .catch(async () => {
              await replaceSession(null);
              return null;
            })
            .finally(() => {
              refreshPromiseRef.current = null;
            });
        }

        return refreshPromiseRef.current;
      }
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
