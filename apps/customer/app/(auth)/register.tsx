import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";

export default function RegisterScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function onRegister() {
    // Day 6 scope: scaffold auth flow and screen wiring.
    router.replace("/(auth)/login");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Dang ky tai khoan</Text>
        <Text style={styles.subtitle}>Mau UI theo Stitch, se noi API dang ky o sprint tiep theo</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Ho va ten</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Nguyen Van A" />
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
          />
          <Text style={styles.label}>Mat khau</Text>
          <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} placeholder="******" />

          <Pressable style={styles.button} onPress={onRegister}>
            <Text style={styles.buttonText}>Tao tai khoan (mock)</Text>
          </Pressable>

          <Text style={styles.footer}>
            Da co tai khoan? <Link href="/(auth)/login" style={styles.link}>Dang nhap</Link>
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8F9FF" },
  container: { flex: 1, justifyContent: "center", padding: 20, gap: 14 },
  title: { fontSize: 30, fontWeight: "700", color: "#0B1C30" },
  subtitle: { color: "#565E74" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#D3E4FE"
  },
  label: { fontSize: 12, fontWeight: "600", color: "#3C4A42" },
  input: {
    borderWidth: 1,
    borderColor: "#BBCABF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: "#fff"
  },
  button: { marginTop: 6, borderRadius: 12, paddingVertical: 13, backgroundColor: "#006C49", alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700" },
  footer: { textAlign: "center", marginTop: 8, color: "#3C4A42" },
  link: { color: "#006C49", fontWeight: "700" }
});
