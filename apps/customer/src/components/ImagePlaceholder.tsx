import { ImageBackground, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { pitchImageByKey } from "../lib/pitchImages";

type Props = {
  height?: number;
  label?: string;
  /** Ảnh local (`require(...)`) hoặc để trống để dùng `imageUrl` / fallback theo `label`. */
  source?: ImageSourcePropType;
  imageUrl?: string;
  borderRadius?: number;
  showBorder?: boolean;
  /** Lớp mờ + chữ — tắt khi hiển thị ảnh sân thật. */
  showOverlay?: boolean;
};

export function ImagePlaceholder({
  height = 160,
  label = "Image placeholder",
  source,
  imageUrl,
  borderRadius = 14,
  showBorder = true,
  showOverlay = false
}: Props) {
  const seed = encodeURIComponent(label.toLowerCase().replace(/\s+/g, "-"));
  const resolvedSource: ImageSourcePropType =
    source ?? (imageUrl ? { uri: imageUrl } : pitchImageByKey(seed));

  return (
    <ImageBackground
      source={resolvedSource}
      resizeMode="cover"
      style={[styles.box, { height, borderRadius, borderWidth: showBorder ? 1 : 0 }]}
      imageStyle={[styles.image, { borderRadius }]}
    >
      {showOverlay ? (
        <View style={[styles.overlay, { borderRadius }]}>
          {label ? <Text style={styles.text}>{label}</Text> : null}
        </View>
      ) : null}
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
