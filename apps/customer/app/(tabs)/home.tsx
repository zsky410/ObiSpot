import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Trang chu</Text>
        <Text style={styles.text}>Day 6: da scaffold tab + auth guard.</Text>
        <Text style={styles.text}>Day 7 se implement list chi nhanh va slot kha dung.</Text>
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
