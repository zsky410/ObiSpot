import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { AuthProvider, useAuth } from "../src/store/auth";

function RootNavigator() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, bootstrapped } = useAuth();

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }
    if (pathname === "/splash") {
      return;
    }
    const isAuthRoute = pathname.startsWith("/(auth)");
    if (!token && !isAuthRoute) {
      router.replace("/(auth)/login");
      return;
    }
    if (token && isAuthRoute) {
      router.replace("/(tabs)/home");
    }
  }, [bootstrapped, pathname, router, token]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}
