import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Exo2_800ExtraBold, useFonts } from "@expo-google-fonts/exo-2";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useMemo } from "react";
import { AuthProvider, useAuth } from "../src/store/auth";

function RootNavigator() {
  const router = useRouter();
  const segments = useSegments();
  const rootSegment = segments[0];
  const { token, bootstrapped } = useAuth();

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }
    if (rootSegment === "splash") {
      return;
    }
    const isAuthRoute = rootSegment === "(auth)";
    if (!token && !isAuthRoute) {
      router.replace("/(auth)/login");
      return;
    }
    if (token && isAuthRoute) {
      router.replace("/(tabs)/home");
    }
  }, [bootstrapped, rootSegment, router, token]);

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
