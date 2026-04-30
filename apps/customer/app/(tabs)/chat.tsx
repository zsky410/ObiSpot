import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { TabHeaderLogo } from "../../src/components/TabHeaderLogo";

export default function ChatScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TabHeaderLogo />
          <Ionicons name="chatbubble-ellipses-outline" size={22} color="#6C7A71" />
        </View>
        <Text style={styles.title}>Tro ly AI</Text>
        <Text style={styles.text}>Day 6: tab scaffold.</Text>
        <Text style={styles.text}>Day 10 se implement chat UI day du.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8F9FF" },
  container: { flex: 1, padding: 20, gap: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  title: { fontSize: 28, fontWeight: "700", color: "#0B1C30" },
  text: { color: "#3C4A42" }
});
