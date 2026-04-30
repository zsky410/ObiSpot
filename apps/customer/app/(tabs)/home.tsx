import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImagePlaceholder } from "../../src/components/ImagePlaceholder";
import { TabHeaderLogo } from "../../src/components/TabHeaderLogo";
import { getVenuesApi } from "../../src/lib/api";

export default function HomeScreen() {
  const venuesQuery = useQuery({
    queryKey: ["venues"],
    queryFn: getVenuesApi
  });

  const displayedVenues = getDisplayedVenues(venuesQuery.data?.items || [], 3);

  function openVenue(venue: { id: string; name: string; address: string }) {
    router.push({
      pathname: "/venue-detail",
      params: {
        venueId: venue.id,
        venueName: venue.name,
        venueAddress: venue.address
      }
    });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TabHeaderLogo />
          <Ionicons name="notifications-outline" size={21} color="#6C7A71" />
        </View>
        <View style={styles.branchHeader}>
          <Text style={styles.branchTitle}>Các chi nhánh hoạt động</Text>
        </View>

        {venuesQuery.isLoading && (
          <View style={styles.centerLoading}>
            <ActivityIndicator color="#087B57" />
          </View>
        )}

        {!venuesQuery.isLoading && (venuesQuery.data?.items?.length || 0) === 0 && (
          <Text style={styles.emptyText}>Chưa có chi nhánh để hiển thị.</Text>
        )}

        <FlatList
          data={displayedVenues}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 12, paddingBottom: 18 }}
          renderItem={({ item }) => (
            <Pressable style={styles.venueCard} onPress={() => openVenue(item)}>
              <ImagePlaceholder
                height={132}
                label="Ảnh sân"
                imageUrl={`https://picsum.photos/seed/venue-${item.id}/1200/700`}
              />
              <View style={styles.ratingTag}>
                <Text style={styles.ratingText}>★ 4.8</Text>
              </View>
              <Text style={styles.venueTitle}>{item.name}</Text>
              <Text style={styles.venueAddress}>📍 {item.address}</Text>
              <View style={styles.badges}>
                <Text style={styles.badge}>Wifi</Text>
                <Text style={styles.badge}>Giữ xe</Text>
                <Text style={styles.badge}>Căng tin</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

function getDisplayedVenues<T extends { id: string }>(items: T[], total: number): T[] {
  if (items.length === 0) {
    return [];
  }
  const result = [...items.slice(0, total)];
  const first = items[0];
  while (result.length < total) {
    result.push({
      ...first,
      id: `${first.id}-dup-${result.length + 1}`
    });
  }
  return result;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6FB" },
  container: { flex: 1, padding: 14, gap: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  branchHeader: { marginTop: 2, marginBottom: 2 },
  branchTitle: { fontSize: 16, fontWeight: "800", color: "#1D3047" },
  centerLoading: { paddingVertical: 14 },
  emptyText: { color: "#5B6574", marginTop: 4 },
  venueCard: {
    borderWidth: 1,
    borderColor: "#D8E1EC",
    borderRadius: 14,
    padding: 10,
    backgroundColor: "#fff",
    gap: 8,
    position: "relative"
  },
  ratingTag: {
    position: "absolute",
    right: 18,
    top: 18,
    backgroundColor: "#F5F9FF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  ratingText: { color: "#184D66", fontWeight: "700", fontSize: 12 },
  venueTitle: { fontSize: 32, fontWeight: "800", color: "#091A2D", lineHeight: 36 },
  venueAddress: { color: "#4B5A6C" },
  badges: { flexDirection: "row", gap: 8, marginTop: 2 },
  badge: {
    backgroundColor: "#EEF3FA",
    color: "#455668",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: "hidden",
    fontSize: 12
  }
});
