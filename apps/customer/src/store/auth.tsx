import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loginApi } from "../lib/api";

const AUTH_STORAGE_KEY = "obispot_auth_session";

type AuthUser = {
  id: string;
  fullName: string;
  role: string;
};

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  bootstrapped: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    bootstrapped: false
  });

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(AUTH_STORAGE_KEY)
      .then((raw) => {
        if (!mounted || !raw) {
          return;
        }
        const parsed = JSON.parse(raw) as { token: string; user: AuthUser };
        setState({ token: parsed.token, user: parsed.user, bootstrapped: true });
      })
      .catch(() => {
        if (mounted) {
          setState((prev) => ({ ...prev, bootstrapped: true }));
        }
      })
      .finally(() => {
        if (mounted) {
          setState((prev) => ({ ...prev, bootstrapped: true }));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      async signIn(email: string, password: string) {
        const result = await loginApi(email, password);
        const payload = { token: result.accessToken, user: result.user };
        await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(payload));
        setState({ ...payload, bootstrapped: true });
      },
      async signOut() {
        await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
        setState({ token: null, user: null, bootstrapped: true });
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
