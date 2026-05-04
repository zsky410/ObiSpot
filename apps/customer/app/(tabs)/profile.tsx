import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TabHeaderLogo } from "../../src/components/TabHeaderLogo";
import { useAuth } from "../../src/store/auth";

export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    setLoading(true);
    try {
      await signOut();
      queryClient.removeQueries({ queryKey: ["my-bookings"] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TabHeaderLogo />
          <Ionicons name="settings-outline" size={22} color="#6C7A71" />
        </View>
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
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
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
