import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { TabHeaderLogo } from "../../src/components/TabHeaderLogo";
import { useAuth } from "../../src/store/auth";

function roleLabelVi(role: string | undefined) {
  if (role === "customer") {
    return "Khách hàng";
  }
  if (role === "admin") {
    return "Quản trị viên";
  }
  return role?.trim() || "—";
}

function displayInitial(fullName: string | undefined) {
  const t = fullName?.trim();
  if (!t) {
    return "?";
  }
  return t.charAt(0).toUpperCase();
}

export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(false);

  const appVersion = useMemo(
    () => Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "1.0.0",
    []
  );

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
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TabHeaderLogo />
          <Pressable
            onPress={() => router.push("/profile-settings")}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Mở cài đặt"
          >
            <Ionicons name="settings-outline" size={22} color="#6C7A71" />
          </Pressable>
        </View>

        <Text style={styles.title}>Cá nhân</Text>
        <Text style={styles.subTitle}>Tài khoản và lối tắt trong ứng dụng</Text>

        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayInitial(user?.fullName)}</Text>
          </View>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroName}>{user?.fullName?.trim() || "Chưa có tên"}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{roleLabelVi(user?.role)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Lối tắt</Text>
        <View style={styles.menuCard}>
          <MenuRow
            icon="calendar-outline"
            title="Lịch đặt của tôi"
            subtitle="Xem và quản lý đơn đặt sân"
            onPress={() => router.push("/(tabs)/my-bookings")}
          />
          <View style={styles.menuDivider} />
          <MenuRow
            icon="chatbox-ellipses-outline"
            title="Tin nhắn hỗ trợ"
            subtitle="Chat với trợ lý ObiSpot"
            onPress={() => router.push("/(tabs)/chat")}
          />
        </View>

        <Text style={styles.sectionLabel}>Ứng dụng</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Phiên bản</Text>
          <Text style={styles.metaValue}>{appVersion}</Text>
        </View>

        <Pressable style={styles.logoutButton} onPress={onLogout} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.logoutText}>Đăng xuất</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({
  icon,
  title,
  subtitle,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]} onPress={onPress}>
      <View style={styles.menuIconWrap}>
        <Ionicons name={icon} size={22} color="#087B57" />
      </View>
      <View style={styles.menuTextCol}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#A8B4C4" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6FB" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 100, gap: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  title: { fontSize: 34, fontWeight: "800", color: "#1A2B3F", marginTop: 4 },
  subTitle: { color: "#5B6574", marginBottom: 6 },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D8E1EC",
    padding: 16
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#E6F5EF",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: { fontSize: 22, fontWeight: "800", color: "#087B57" },
  heroTextCol: { flex: 1, gap: 8 },
  heroName: { fontSize: 18, fontWeight: "800", color: "#0B1C30" },
  rolePill: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF3FA",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999
  },
  rolePillText: { fontSize: 12, fontWeight: "700", color: "#455668" },
  sectionLabel: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "800",
    color: "#6C7B90",
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  menuCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DFE7F2",
    overflow: "hidden"
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12
  },
  menuRowPressed: { backgroundColor: "#F6F9FC" },
  menuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#E8F7F1",
    alignItems: "center",
    justifyContent: "center"
  },
  menuTextCol: { flex: 1, gap: 2 },
  menuTitle: { fontSize: 16, fontWeight: "700", color: "#1A2B3F" },
  menuSubtitle: { fontSize: 13, color: "#5B6574" },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#E6ECF4", marginLeft: 66 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DFE7F2",
    paddingVertical: 14,
    paddingHorizontal: 16
  },
  metaLabel: { color: "#5B6574", fontSize: 14 },
  metaValue: { fontWeight: "700", color: "#1A2B3F", fontSize: 14 },
  logoutButton: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: "#BA1A1A",
    alignItems: "center"
  },
  logoutText: { color: "#fff", fontWeight: "700", fontSize: 16 }
});
