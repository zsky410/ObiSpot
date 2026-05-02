import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/store/auth";

export default function SplashScreen() {
  const { token, bootstrapped } = useAuth();
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    ]).start();
  }, [fade, scale]);

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }
    const timeout = setTimeout(() => {
      if (token) {
        router.replace("/(tabs)/home");
      } else {
        router.replace("/(auth)/login");
      }
    }, 1600);
    return () => clearTimeout(timeout);
  }, [bootstrapped, token]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Animated.View style={[styles.brandWrap, { opacity: fade, transform: [{ scale }] }]}>
          <Image source={require("../assets/obispot_logo.png")} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>ObiSpot</Text>
          <Text style={styles.subtitle}>Đặt sân bóng đá nhanh và ổn định</Text>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  brandWrap: { alignItems: "center", gap: 8 },
  logo: { width: 152, height: 152 },
  title: { fontSize: 36, fontWeight: "800", color: "#0F2742" },
  subtitle: { fontSize: 14, color: "#5E7088" }
});
