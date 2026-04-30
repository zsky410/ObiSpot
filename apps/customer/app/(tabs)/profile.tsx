import { useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../src/store/auth";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    setLoading(true);
    try {
      await signOut();
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Tai khoan</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Ho ten</Text>
          <Text style={styles.value}>{user?.fullName || "Chua co du lieu"}</Text>
          <Text style={styles.label}>Role</Text>
          <Text style={styles.value}>{user?.role || "-"}</Text>
          <Text style={styles.label}>User ID</Text>
          <Text style={styles.value} numberOfLines={1}>
            {user?.id || "-"}
          </Text>
        </View>
        <Pressable style={styles.logoutButton} onPress={onLogout} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.logoutText}>Dang xuat</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8F9FF" },
  container: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", color: "#0B1C30" },
  card: {
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#D3E4FE",
    padding: 16,
    gap: 6
  },
  label: { color: "#6C7A71", fontSize: 12, fontWeight: "600" },
  value: { color: "#0B1C30", fontSize: 14 },
  logoutButton: {
    marginTop: 6,
    borderRadius: 12,
    paddingVertical: 13,
    backgroundColor: "#BA1A1A",
    alignItems: "center"
  },
  logoutText: { color: "#fff", fontWeight: "700" }
});
