import { ImageBackground, StyleSheet, Text, View } from "react-native";

type Props = {
  height?: number;
  label?: string;
  imageUrl?: string;
  borderRadius?: number;
  showBorder?: boolean;
};

export function ImagePlaceholder({
  height = 160,
  label = "Image placeholder",
  imageUrl,
  borderRadius = 14,
  showBorder = true
}: Props) {
  const seed = encodeURIComponent(label.toLowerCase().replace(/\s+/g, "-"));
  const source = {
    uri: imageUrl || `https://picsum.photos/seed/${seed}/1200/800`
  };

  return (
    <ImageBackground
      source={source}
      resizeMode="cover"
      style={[styles.box, { height, borderRadius, borderWidth: showBorder ? 1 : 0 }]}
      imageStyle={[styles.image, { borderRadius }]}
    >
      <View style={[styles.overlay, { borderRadius }]}>
        <Text style={styles.text}>{label}</Text>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  box: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#BFD1E4"
  },
  image: {
    borderRadius: 14
  },
  overlay: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "rgba(8, 22, 39, 0.28)",
    alignItems: "center",
    justifyContent: "center"
  },
  text: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
    letterSpacing: 0.2
  }
});
