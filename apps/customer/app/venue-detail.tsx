import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ImagePlaceholder } from "../src/components/ImagePlaceholder";
import { pitchImageByKey } from "../src/lib/pitchImages";

export default function VenueDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    venueId?: string;
    venueName?: string;
    venueAddress?: string;
  }>();

  const venueId = params.venueId || "";
  const venueName = params.venueName || "Hệ thống sân";
  const venueAddress = params.venueAddress || "Địa chỉ cập nhật sau";
  const [selectedPitchType, setSelectedPitchType] = useState<"5" | "7">("5");

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 110 + insets.bottom }]}>
        <View style={styles.heroWrap}>
          <ImagePlaceholder
            height={220}
            source={pitchImageByKey(venueId || "default")}
            borderRadius={0}
            showBorder={false}
          />
          <View style={styles.heroHeader}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <View style={styles.heroRightSpace} />
          </View>
        </View>
        <View style={styles.infoCard}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{venueName}</Text>
            <View style={styles.ratingPill}>
              <Text style={styles.rating}>⭐ 4.8</Text>
            </View>
          </View>
          <Text style={styles.address}>📍 {venueAddress}</Text>
          <Text style={styles.sectionTitle}>Giới thiệu</Text>
          <Text style={styles.bodyText}>
            Sân cỏ nhân tạo chất lượng cao, hệ thống chiếu sáng chuẩn FIFA, không gian thoáng đãng.
          </Text>
          <Text style={styles.sectionTitle}>Tiện ích</Text>
          <View style={styles.grid}>
            {[
              { label: "Wifi", icon: "wifi-outline" },
              { label: "Giữ xe", icon: "car-outline" },
              { label: "Căng tin", icon: "cafe-outline" },
              { label: "Phòng thay đồ", icon: "shirt-outline" },
              { label: "Nước uống", icon: "water-outline" }
            ].map((item) => (
              <View key={item.label} style={styles.gridItem}>
                <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color="#0C8F60" />
                <Text style={styles.gridText}>{item.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.sectionTitle}>Chọn loại sân</Text>
          <View style={styles.typesRow}>
            <Pressable
              style={[styles.typePill, selectedPitchType === "5" && styles.typePillActive]}
              onPress={() => setSelectedPitchType("5")}
            >
              <Text style={[styles.typeText, selectedPitchType === "5" && styles.typeTextActive]}>Sân 5 người</Text>
            </Pressable>
            <Pressable
              style={[styles.typePill, selectedPitchType === "7" && styles.typePillActive]}
              onPress={() => setSelectedPitchType("7")}
            >
              <Text style={[styles.typeText, selectedPitchType === "7" && styles.typeTextActive]}>Sân 7 người</Text>
            </Pressable>
          </View>
        </View>

      </ScrollView>
      <View style={[styles.bottomCtaWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable
          style={styles.primaryButton}
          onPress={() =>
            router.push({
              pathname: "/schedule-booking",
              params: { venueId, venueName, venueAddress }
            })
          }
        >
          <Text style={styles.primaryButtonText}>ĐẶT SÂN NGAY</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F2F5FA" },
  container: { paddingTop: 0, gap: 0, backgroundColor: "#F2F5FA" },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(5, 16, 28, 0.32)",
    alignItems: "center",
    justifyContent: "center"
  },
  backText: { color: "#FFFFFF", fontSize: 24, fontWeight: "700", lineHeight: 26 },
  heroWrap: {
    marginTop: 0,
    position: "relative"
  },
  heroHeader: {
    position: "absolute",
    top: 10,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  heroRightSpace: { width: 36, height: 36 },
  infoCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 8,
    marginTop: -22
  },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: "800", color: "#0B1C30" },
  ratingPill: { backgroundColor: "#E9F0FB", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  rating: { color: "#5D6B80", fontWeight: "700" },
  address: { color: "#5B6678" },
  sectionTitle: { marginTop: 6, fontSize: 17, lineHeight: 22, fontWeight: "700", color: "#0B1C30" },
  bodyText: { color: "#4E5D70", lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridItem: {
    minWidth: "30%",
    backgroundColor: "#F1F5FB",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    gap: 4
  },
  gridText: { color: "#3E5065", fontSize: 12, fontWeight: "600" },
  typesRow: { flexDirection: "row", gap: 8 },
  typePill: { flex: 1, borderWidth: 1, borderColor: "#BFD0C2", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  typePillActive: { backgroundColor: "#087B57", borderColor: "#087B57" },
  typeText: { color: "#1D2E45", fontWeight: "700" },
  typeTextActive: { color: "#fff" },
  bottomCtaWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    backgroundColor: "#F2F5FA"
  },
  primaryButton: {
    marginHorizontal: 14,
    backgroundColor: "#087B57",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center"
  },
  primaryButtonText: { color: "#fff", fontWeight: "800" }
});
