import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loginApi, refreshSessionApi, type AuthSessionPayload } from "../lib/api";

const AUTH_STORAGE_KEY = "obispot_auth_session";
const TOKEN_REFRESH_SKEW_MS = 60_000;

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

  async function persistSession(session: StoredAuthSession | null) {
    if (!session) {
      await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
      return;
    }
    await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(session));
  }

  function setSessionState(session: StoredAuthSession | null, bootstrapped = true) {
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
        const raw = await SecureStore.getItemAsync(AUTH_STORAGE_KEY);
        if (!mounted) {
          return;
        }

        if (!raw) {
          setSessionState(null);
          return;
        }

        const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;
        if (!parsed.token || !parsed.refreshToken || !parsed.user) {
          await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
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

        if (!shouldRefreshToken(storedSession.expiresAt)) {
          setSessionState(storedSession);
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
          await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
          if (mounted) {
            setSessionState(null);
          }
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
        if (!state.token || !state.refreshToken) {
          return null;
        }

        if (!shouldRefreshToken(state.expiresAt)) {
          return state.token;
        }

        if (!refreshPromiseRef.current) {
          refreshPromiseRef.current = refreshWithToken(state.refreshToken)
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
