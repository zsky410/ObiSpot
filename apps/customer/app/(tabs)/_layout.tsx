import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#006C49",
        tabBarInactiveTintColor: "#6C7A71"
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="my-bookings" options={{ title: "Don cua toi" }} />
      <Tabs.Screen name="chat" options={{ title: "AI" }} />
      <Tabs.Screen name="profile" options={{ title: "Tai khoan" }} />
    </Tabs>
  );
}
