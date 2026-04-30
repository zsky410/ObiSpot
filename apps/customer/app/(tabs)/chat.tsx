import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function ChatScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
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
  title: { fontSize: 28, fontWeight: "700", color: "#0B1C30" },
  text: { color: "#3C4A42" }
});
