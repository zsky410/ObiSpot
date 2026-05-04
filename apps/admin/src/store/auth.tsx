/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loginApi, refreshSessionApi, type AuthSessionPayload } from "../lib/api";

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  user: AuthSessionPayload["user"] | null;
};

type AuthContextType = {
  ready: boolean;
  auth: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  getValidAccessToken: () => Promise<string | null>;
};

const AUTH_STORAGE_KEY = "obispot_admin_auth";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readStoredAuth(): AuthState {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return { accessToken: null, refreshToken: null, expiresAt: null, user: null };
    }
    return JSON.parse(raw) as AuthState;
  } catch {
    return { accessToken: null, refreshToken: null, expiresAt: null, user: null };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => readStoredAuth());
  const ready = true;

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  }, [auth, ready]);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await loginApi(email, password);
    if (session.user.role !== "admin") {
      throw new Error("Tài khoản không có quyền admin.");
    }
    setAuth({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: session.user
    });
  }, []);

  const signOut = useCallback(() => {
    setAuth({ accessToken: null, refreshToken: null, expiresAt: null, user: null });
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const getValidAccessToken = useCallback(async () => {
    if (!auth.accessToken) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!auth.expiresAt || auth.expiresAt - nowSec > 30) {
      return auth.accessToken;
    }
    if (!auth.refreshToken) {
      signOut();
      return null;
    }
    try {
      const next = await refreshSessionApi(auth.refreshToken);
      if (next.user.role !== "admin") {
        signOut();
        return null;
      }
      setAuth({
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt,
        user: next.user
      });
      return next.accessToken;
    } catch {
      signOut();
      return null;
    }
  }, [auth.accessToken, auth.expiresAt, auth.refreshToken, signOut]);

  const value = useMemo<AuthContextType>(
    () => ({ ready, auth, signIn, signOut, getValidAccessToken }),
    [ready, auth, signIn, signOut, getValidAccessToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
