import Constants from "expo-constants";
import { router } from "expo-router";
import { useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/store/auth";

function roleLabelVi(role: string | undefined) {
  if (role === "customer") {
    return "Khách hàng";
  }
  if (role === "admin") {
    return "Quản trị viên";
  }
  return role?.trim() || "—";
}

export default function ProfileSettingsScreen() {
  const { user } = useAuth();

  const appVersion = useMemo(
    () => Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "1.0.0",
    []
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color="#1A2B3F" />
        </Pressable>
        <Text style={styles.topTitle}>Cài đặt</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Tài khoản</Text>
        <View style={styles.card}>
          <InfoRow label="Họ và tên" value={user?.fullName?.trim() || "—"} />
          <View style={styles.divider} />
          <InfoRow label="Vai trò" value={roleLabelVi(user?.role)} />
          <View style={styles.divider} />
          <InfoRow label="Mã người dùng" value={user?.id || "—"} monospace />
        </View>

        <Text style={styles.sectionLabel}>Giới thiệu</Text>
        <View style={styles.card}>
          <Text style={styles.aboutText}>
            ObiSpot giúp bạn tìm chi nhánh, chọn khung giờ và hoàn tất đặt sân nhanh chóng. Liên hệ chủ sân nếu cần hỗ trợ
            ngoài phạm vi ứng dụng.
          </Text>
        </View>

        <View style={styles.versionFoot}>
          <Text style={styles.versionLabel}>Phiên bản ứng dụng</Text>
          <Text style={styles.versionValue}>{appVersion}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, monospace }: { label: string; value: string; monospace?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, monospace && styles.infoMono]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6FB" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#D8E1EC",
    backgroundColor: "#F3F6FB"
  },
  backBtn: { padding: 4, width: 40 },
  topTitle: { fontSize: 17, fontWeight: "800", color: "#1A2B3F" },
  topBarSpacer: { width: 40 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 10 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#6C7B90",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 4
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DFE7F2",
    padding: 4
  },
  infoRow: { paddingVertical: 12, paddingHorizontal: 12, gap: 6 },
  infoLabel: { fontSize: 12, fontWeight: "700", color: "#6C7B90" },
  infoValue: { fontSize: 15, fontWeight: "600", color: "#0B1C30" },
  infoMono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined }) },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#E6ECF4", marginLeft: 12 },
  aboutText: {
    padding: 14,
    fontSize: 14,
    lineHeight: 22,
    color: "#4B5A6C"
  },
  versionFoot: {
    marginTop: 12,
    alignItems: "center",
    gap: 4
  },
  versionLabel: { fontSize: 12, color: "#8A98A9" },
  versionValue: { fontSize: 13, fontWeight: "700", color: "#5B6574" }
});
