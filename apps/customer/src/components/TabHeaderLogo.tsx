import { Image, StyleSheet, View } from "react-native";

export function TabHeaderLogo() {
  return (
    <View style={styles.wrap}>
      <Image source={require("../../assets/obispottext_logo.png")} style={styles.logo} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 4
  },
  logo: {
    width: 168,
    height: 44
  }
});
