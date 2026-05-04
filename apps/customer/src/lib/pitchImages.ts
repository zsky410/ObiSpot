import type { ImageSourcePropType } from "react-native";

const san1 = require("../../assets/pitches/san1.jpg");
const san2 = require("../../assets/pitches/san2.webp");
const san3 = require("../../assets/pitches/san3.webp");

/** Ba ảnh sân — thứ tự: sân 1, 2, 3. */
export const PITCH_IMAGES: ImageSourcePropType[] = [san1, san2, san3];

/** Chi nhánh demo trong seed `002_three_branches_reset.sql` — mỗi nơi một ảnh, không trùng. */
const DEMO_VENUE_IMAGE_INDEX: Record<string, number> = {
  "11111111-1111-4111-a111-111111111101": 0,
  "11111111-1111-4111-a111-111111111102": 1,
  "11111111-1111-4111-a111-111111111103": 2
};

export function pitchImageByIndex(index: number): ImageSourcePropType {
  const i = ((index % PITCH_IMAGES.length) + PITCH_IMAGES.length) % PITCH_IMAGES.length;
  return PITCH_IMAGES[i];
}

function indexFromUuidString(uuid: string): number | null {
  const compact = uuid.replace(/-/g, "").toLowerCase();
  if (compact.length < 8 || !/^[0-9a-f]+$/.test(compact)) {
    return null;
  }
  const n = parseInt(compact.slice(-8), 16);
  if (!Number.isFinite(n)) {
    return null;
  }
  return ((n % PITCH_IMAGES.length) + PITCH_IMAGES.length) % PITCH_IMAGES.length;
}

/**
 * Cùng một venueId luôn cùng một ảnh.
 * - Ba chi nhánh demo: cố định san1 / san2 / san3.
 * - UUID khác: lấy 8 hex cuối % 3 (phân bổ ổn định hơn FNV trên cả chuỗi).
 * - Chuỗi không phải UUID: hash đơn giản theo ký tự.
 */
export function pitchImageByKey(key: string): ImageSourcePropType {
  const normalized = key.replace(/-dup-\d+$/i, "").trim();
  if (!normalized) {
    return PITCH_IMAGES[0];
  }

  const lower = normalized.toLowerCase();
  const demoIdx = DEMO_VENUE_IMAGE_INDEX[lower];
  if (demoIdx !== undefined) {
    return PITCH_IMAGES[demoIdx];
  }

  const uuidish =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized);
  if (uuidish) {
    const fromUuid = indexFromUuidString(normalized);
    if (fromUuid !== null) {
      return PITCH_IMAGES[fromUuid];
    }
  }

  let h = 0;
  for (let i = 0; i < lower.length; i++) {
    h = (h + lower.charCodeAt(i) * (i + 1)) % 997;
  }
  return PITCH_IMAGES[h % PITCH_IMAGES.length];
}
