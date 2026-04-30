import { Link, router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/store/auth";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("user@obispot.demo");
  const [password, setPassword] = useState("user");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit() {
    setLoading(true);
    setError("");
    try {
      await signIn(email, password);
      router.replace("/(tabs)/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
        <View style={styles.card}>
          <View style={styles.brandBlock}>
            <Image source={require("../../assets/obispot_logo.png")} style={styles.logo} resizeMode="contain" />
            <Text style={styles.subtitle}>ObiSpot - Nền tảng đặt sân chuyên nghiệp</Text>
          </View>

          <Text style={styles.label}>Số điện thoại</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="Nhập số điện thoại hoặc email"
            style={styles.input}
          />
          <View style={styles.passwordRow}>
            <Text style={styles.label}>Mật khẩu</Text>
            <Text style={styles.forgotText}>Quên mật khẩu?</Text>
          </View>
          <TextInput
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="******"
            style={styles.input}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Đăng nhập</Text>}
          </Pressable>

          <View style={styles.divider} />
          <Text style={styles.footerText}>
            Chưa có tài khoản? <Link href="/(auth)/register" style={styles.link}>Đăng ký</Link>
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0F2742" },
  container: { flex: 1, justifyContent: "center", padding: 14 },
  card: {
    backgroundColor: "#F6F7FB",
    borderRadius: 14,
    padding: 16,
    gap: 9,
    borderWidth: 1,
    borderColor: "#CDD5DF"
  },
  brandBlock: { alignItems: "center", marginBottom: 4 },
  logo: { width: 118, height: 118, marginBottom: 8 },
  subtitle: { color: "#5B6574", fontSize: 15, marginTop: 2, marginBottom: 8, textAlign: "center" },
  label: { fontSize: 12, fontWeight: "600", color: "#3C4A42" },
  input: {
    borderWidth: 1,
    borderColor: "#A9B4C2",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#F9FBFF"
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  forgotText: {
    fontSize: 12,
    color: "#0B8462",
    fontWeight: "700"
  },
  button: {
    marginTop: 6,
    borderRadius: 10,
    paddingVertical: 13,
    backgroundColor: "#087B57",
    alignItems: "center"
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  divider: { marginTop: 8, borderTopWidth: 1, borderTopColor: "#D8DEE8" },
  footerText: { textAlign: "center", marginTop: 8, color: "#4D5868" },
  link: { color: "#087B57", fontWeight: "700" },
  error: { color: "#BA1A1A" }
});
