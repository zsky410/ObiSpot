import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Exo2_800ExtraBold, useFonts } from "@expo-google-fonts/exo-2";
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
  const [fontsLoaded] = useFonts({
    Exo2_800ExtraBold
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}
